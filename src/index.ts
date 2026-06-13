import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

type SafetyRisk = "low" | "medium" | "high";
export type AgentFoodType =
  | "mcp"
  | "agent-skills"
  | "evaluation"
  | "benchmark"
  | "catalog"
  | "memory"
  | "rag"
  | "local-agent"
  | "full-agent"
  | "agent-rules"
  | "github-automation"
  | "sandbox"
  | "dev-workflow"
  | "obsidian"
  | "unknown";

type QueryConfig = {
  name: string;
  query: string;
  per_query?: number;
};

type AppConfig = {
  defaults?: {
    per_query?: number;
    max_readme_chars?: number;
    min_agent_usefulness_score?: number;
  };
  queries: QueryConfig[];
};

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  pushed_at: string;
  updated_at: string;
  created_at: string;
  archived: boolean;
  disabled: boolean;
  license: { spdx_id: string; name: string } | null;
  owner: {
    login: string;
    html_url: string;
  };
};

type SearchResponse = {
  items: GitHubRepo[];
};

export type RepoNote = {
  repo: GitHubRepo;
  readme: string;
  discoveredBy: string[];
  scores: Scores;
  agentFoodType: AgentFoodType[];
  firstSeen: string;
  lastChecked: string;
};

export type Scores = {
  agent_usefulness_score: number;
  note_potential_score: number;
  freshness_score: number;
  tryability_score: number;
  safety_risk: SafetyRisk;
  safety_risk_score: number;
  madowaku_interest_match: number;
};

const rootDir = process.cwd();
const today = new Date().toISOString().slice(0, 10);

async function main() {
  await loadDotEnv(path.join(rootDir, ".env"));

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is missing. Copy .env.example to .env and set a token.");
  }

  const configPath = path.resolve(rootDir, process.env.REPO_GARDEN_CONFIG ?? "config/keywords.yml");
  const vaultDir = path.resolve(rootDir, process.env.REPO_GARDEN_VAULT ?? "vault");
  const inboxDir = path.join(vaultDir, "00_Inbox");
  const quarantineDir = path.join(vaultDir, "90_Quarantine");
  const config = await readConfig(configPath);
  await mkdir(inboxDir, { recursive: true });
  await mkdir(quarantineDir, { recursive: true });

  const found = new Map<string, { repo: GitHubRepo; discoveredBy: Set<string> }>();
  for (const query of config.queries) {
    const perPage = query.per_query ?? config.defaults?.per_query ?? 8;
    const repos = await searchRepositories(query.query, perPage, token);
    for (const repo of repos) {
      const current = found.get(repo.full_name);
      if (current) {
        current.discoveredBy.add(query.name);
      } else {
        found.set(repo.full_name, { repo, discoveredBy: new Set([query.name]) });
      }
    }
  }

  const notes: RepoNote[] = [];
  const maxReadmeChars = config.defaults?.max_readme_chars ?? 12000;
  const minScore = config.defaults?.min_agent_usefulness_score ?? 0;

  for (const { repo, discoveredBy } of found.values()) {
    const readme = await getReadme(repo.full_name, token, maxReadmeChars);
    const scores = scoreRepo(repo, readme);
    if (scores.agent_usefulness_score < minScore) {
      continue;
    }

    const notePath = getRepoNotePath(vaultDir, repo.full_name, scores.safety_risk);
    const firstSeen = await readFirstSeenForRepo(vaultDir, repo.full_name);
    const note: RepoNote = {
      repo,
      readme,
      discoveredBy: [...discoveredBy].sort(),
      scores,
      agentFoodType: classifyAgentFoodType(repo, readme),
      firstSeen: firstSeen ?? today,
      lastChecked: today
    };
    await writeFile(notePath, renderRepoNote(note), "utf8");
    notes.push(note);
  }

  notes.sort((a, b) => {
    const bTotal = b.scores.agent_usefulness_score + b.scores.note_potential_score;
    const aTotal = a.scores.agent_usefulness_score + a.scores.note_potential_score;
    return bTotal - aTotal;
  });

  await writeFile(path.join(inboxDir, "weekly_digest.md"), renderDigest(notes), "utf8");

  console.log(`Saved ${notes.length} repo notes under ${path.relative(rootDir, vaultDir)}`);
  console.log(`Updated ${path.relative(rootDir, path.join(inboxDir, "weekly_digest.md"))}`);
}

async function readConfig(configPath: string): Promise<AppConfig> {
  const raw = await readFile(configPath, "utf8");
  const config = YAML.parse(raw) as AppConfig;
  if (!config.queries?.length) {
    throw new Error(`No queries found in ${configPath}`);
  }
  return config;
}

async function loadDotEnv(envPath: string) {
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional for commands that provide GITHUB_TOKEN through the process env.
  }
}

async function searchRepositories(query: string, perPage: number, token: string): Promise<GitHubRepo[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "updated");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(perPage));

  const res = await githubFetch(url, token, "application/vnd.github+json");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub search failed (${res.status}) for "${query}": ${body}`);
  }

  const data = (await res.json()) as SearchResponse;
  return data.items ?? [];
}

async function getReadme(fullName: string, token: string, maxChars: number): Promise<string> {
  const url = new URL(`https://api.github.com/repos/${fullName}/readme`);
  const res = await githubFetch(url, token, "application/vnd.github.raw");
  if (!res.ok) {
    console.warn(`README unavailable for ${fullName} (${res.status}); continuing.`);
    return "";
  }
  const text = await res.text();
  return text.slice(0, maxChars);
}

async function githubFetch(url: URL, token: string, accept: string) {
  return fetch(url, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "repo-garden-cli"
    }
  });
}

export function scoreRepo(repo: GitHubRepo, readme: string): Scores {
  const text = [
    repo.full_name,
    repo.description ?? "",
    repo.language ?? "",
    ...(repo.topics ?? []),
    readme
  ].join(" ").toLowerCase();

  const agentKeywords = countMatches(text, [
    "agent",
    "agents.md",
    "coding agent",
    "mcp",
    "model context protocol",
    "tool use",
    "function calling",
    "rag",
    "memory",
    "sandbox",
    "workflow",
    "automation"
  ]);
  const madowakuKeywords = countMatches(text, [
    "obsidian",
    "markdown",
    "github",
    "pull request",
    "mcp",
    "agents.md",
    "coding agent",
    "memory",
    "rag",
    "sandbox",
    "cli"
  ]);
  const tryKeywords = countMatches(text, [
    "quickstart",
    "getting started",
    "install",
    "npm",
    "pnpm",
    "pip",
    "uv",
    "docker",
    "example",
    "demo"
  ]);
  const riskKeywords = countMatches(text, [
    "shell",
    "exec",
    "sandbox",
    "browser automation",
    "token",
    "credential",
    "secrets",
    "malware",
    "arbitrary code"
  ]);

  const freshness = scoreFreshness(repo.pushed_at);
  const starSignal = Math.min(18, Math.log10(repo.stargazers_count + 1) * 8);
  const readmeSignal = readme.length > 800 ? 10 : readme.length > 200 ? 5 : 0;
  const topicSignal = Math.min(10, (repo.topics?.length ?? 0) * 2);
  const archivedPenalty = repo.archived || repo.disabled ? 25 : 0;

  const agentUsefulness = clamp(agentKeywords * 6 + starSignal + topicSignal + freshness * 0.25 - archivedPenalty);
  const notePotential = clamp(readmeSignal + starSignal + freshness * 0.2 + agentKeywords * 3 + madowakuKeywords * 2);
  const tryability = clamp(tryKeywords * 7 + readmeSignal + (repo.language ? 8 : 0) - archivedPenalty);
  const madowakuMatch = clamp(madowakuKeywords * 7 + agentKeywords * 2 + topicSignal);
  const safetyRiskScore = clamp(riskKeywords * 12 + (text.includes("autonomous") ? 8 : 0));

  return {
    agent_usefulness_score: Math.round(agentUsefulness),
    note_potential_score: Math.round(notePotential),
    freshness_score: Math.round(freshness),
    tryability_score: Math.round(tryability),
    safety_risk: safetyRiskScore >= 50 ? "high" : safetyRiskScore >= 25 ? "medium" : "low",
    safety_risk_score: Math.round(safetyRiskScore),
    madowaku_interest_match: Math.round(madowakuMatch)
  };
}

export function classifyAgentFoodType(repo: GitHubRepo, readme: string): AgentFoodType[] {
  const text = repoText(repo, readme);
  const rules: Array<[AgentFoodType, string[]]> = [
    ["mcp", ["mcp", "model context protocol"]],
    ["agent-skills", ["skill", "skills", "agent skill", "codex skill"]],
    ["evaluation", ["evaluation", "evaluate", "eval", "evals", "judge", "scoring"]],
    ["benchmark", ["benchmark", "benchmarks", "leaderboard", "swe-bench", "terminal-bench"]],
    ["catalog", ["awesome", "awesome-list", "catalog", "directory", "radar", "landscape", "curated list"]],
    ["memory", ["memory", "memories", "persistent memory", "long-term memory"]],
    ["rag", ["rag", "retrieval", "vector database", "embeddings", "semantic search"]],
    ["local-agent", ["local agent", "local-first", "desktop agent", "cli agent", "on-device"]],
    ["full-agent", ["full agent", "autonomous agent", "agent framework", "multi-agent", "end-to-end agent"]],
    ["agent-rules", ["agents.md", "agent rules", "instructions", "coding agent rules", "system prompt"]],
    ["github-automation", ["github automation", "pull request", "github action", "issues", "repository automation"]],
    ["sandbox", ["sandbox", "code execution", "isolated execution", "container", "docker"]],
    ["dev-workflow", ["developer workflow", "dev workflow", "coding workflow", "automation workflow", "code review"]],
    ["obsidian", ["obsidian", "vault", "wikilink", "markdown knowledge base"]]
  ];

  const matches: AgentFoodType[] = [];
  for (const [type, needles] of rules) {
    if (needles.some((needle) => textMatchesNeedle(text, needle))) {
      matches.push(type);
    }
  }
  return matches.length ? matches : ["unknown"];
}

function textMatchesNeedle(text: string, needle: string): boolean {
  if (/^[a-z0-9-]+$/i.test(needle) && needle.length <= 5) {
    return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(text);
  }
  return text.includes(needle);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repoText(repo: GitHubRepo, readme: string): string {
  return [
    repo.full_name,
    repo.description ?? "",
    repo.language ?? "",
    ...(repo.topics ?? []),
    readme
  ].join(" ").toLowerCase();
}

function scoreFreshness(pushedAt: string): number {
  const ageDays = Math.max(0, (Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
  if (ageDays <= 14) return 100;
  if (ageDays <= 60) return 80;
  if (ageDays <= 180) return 60;
  if (ageDays <= 365) return 40;
  if (ageDays <= 730) return 20;
  return 5;
}

function countMatches(text: string, needles: string[]): number {
  return needles.reduce((count, needle) => count + (text.includes(needle) ? 1 : 0), 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

async function readFirstSeen(notePath: string): Promise<string | null> {
  try {
    const raw = await readFile(notePath, "utf8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    const firstSeen = match[1].match(/^first_seen:\s*"?([^"\r\n]+)"?/m);
    return firstSeen?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readFirstSeenForRepo(vaultDir: string, fullName: string): Promise<string | null> {
  const inboxPath = getRepoNotePath(vaultDir, fullName, "low");
  const quarantinePath = getRepoNotePath(vaultDir, fullName, "high");
  return (await readFirstSeen(inboxPath)) ?? (await readFirstSeen(quarantinePath));
}

export function getRepoNotePath(vaultDir: string, fullName: string, risk: SafetyRisk): string {
  const folder = risk === "high" ? "90_Quarantine" : "00_Inbox";
  return path.join(vaultDir, folder, `${safeFileName(fullName)}.md`);
}

export function renderRepoNote(note: RepoNote): string {
  const { repo, scores } = note;
  const title = `${repo.full_name} - repo discovery`;
  const tags = ["repo-garden", "ai-agent", ...note.discoveredBy.map((name) => `repo-garden/${name}`)];
  const readmeExcerpt = note.readme ? truncateForNote(note.readme, 2500) : "README could not be fetched during the latest check.";
  const reasons = buildReasons(note);

  return `---
title: ${yamlString(title)}
tags:
${tags.map((tag) => `  - ${yamlString(tag)}`).join("\n")}
github_repo: ${yamlString(repo.full_name)}
repo_url: ${yamlString(repo.html_url)}
owner: ${yamlString(repo.owner.login)}
language: ${yamlString(repo.language ?? "unknown")}
stars: ${repo.stargazers_count}
forks: ${repo.forks_count}
open_issues: ${repo.open_issues_count}
license: ${yamlString(repo.license?.spdx_id ?? "unknown")}
topics:
${(repo.topics?.length ? repo.topics : ["untagged"]).map((topic) => `  - ${yamlString(topic)}`).join("\n")}
discovered_by:
${note.discoveredBy.map((name) => `  - ${yamlString(name)}`).join("\n")}
agent_food_type:
${note.agentFoodType.map((type) => `  - ${type}`).join("\n")}
agent_usefulness_score: ${scores.agent_usefulness_score}
note_potential_score: ${scores.note_potential_score}
freshness_score: ${scores.freshness_score}
tryability_score: ${scores.tryability_score}
safety_risk: ${scores.safety_risk}
safety_risk_score: ${scores.safety_risk_score}
madowaku_interest_match: ${scores.madowaku_interest_match}
first_seen: ${note.firstSeen}
last_checked: ${note.lastChecked}
pushed_at: ${repo.pushed_at}
archived: ${repo.archived}
---

# ${repo.full_name}

[GitHub](${repo.html_url}) by [${repo.owner.login}](${repo.owner.html_url})

> [!summary]
> ${repo.description ?? "No repository description."}

## なぜ気になった？

- agent_reason: ${reasons.agent_reason}
- note_reason: ${reasons.note_reason}
- try_reason: ${reasons.try_reason}
- risk_reason: ${reasons.risk_reason}

## Scores

| Metric | Score |
| --- | ---: |
| Agent usefulness | ${scores.agent_usefulness_score} |
| Note potential | ${scores.note_potential_score} |
| Freshness | ${scores.freshness_score} |
| Tryability | ${scores.tryability_score} |
| Madowaku interest match | ${scores.madowaku_interest_match} |
| Safety risk | ${scores.safety_risk} (${scores.safety_risk_score}) |

## Why It Might Matter

- Agent angle: ${agentAngle(scores.agent_usefulness_score)}
- Note angle: ${noteAngle(scores.note_potential_score)}
- Tryability: ${tryAngle(scores.tryability_score)}
- Safety read: ${safetyAngle(scores.safety_risk)}

## Repository Facts

- Language: ${repo.language ?? "unknown"}
- Stars: ${repo.stargazers_count}
- Forks: ${repo.forks_count}
- Open issues: ${repo.open_issues_count}
- Last pushed: ${repo.pushed_at}
- Topics: ${(repo.topics ?? []).join(", ") || "none"}
- Agent food type: ${note.agentFoodType.join(", ")}

## README Excerpt

\`\`\`markdown
${readmeExcerpt}
\`\`\`
`;
}

function buildReasons(note: RepoNote) {
  const { repo, scores } = note;
  const topicHint = repo.topics?.length ? `topics include ${repo.topics.slice(0, 4).join(", ")}` : "topics are sparse";
  return {
    agent_reason: `${note.agentFoodType.join(", ")} signal with agent usefulness ${scores.agent_usefulness_score}; ${repo.description ?? "description is empty"}, and ${topicHint}.`,
    note_reason: `Note potential ${scores.note_potential_score}; ${noteAngle(scores.note_potential_score)}`,
    try_reason: `Tryability ${scores.tryability_score}; ${tryAngle(scores.tryability_score)}`,
    risk_reason: `Safety risk is ${scores.safety_risk} (${scores.safety_risk_score}); ${safetyAngle(scores.safety_risk)}`
  };
}

export function renderDigest(notes: RepoNote[]): string {
  const top = capByOwner(notes, 20, 2);
  return `---
title: Weekly Repo Garden Digest
tags:
  - repo-garden
  - weekly-digest
last_checked: ${today}
repo_count: ${notes.length}
---

# Weekly Repo Garden Digest

> [!note]
> Generated from the latest GitHub discovery run on ${today}.

## Top Finds

${top
  .map((note, index) => {
    const file = safeFileName(note.repo.full_name);
    return `${index + 1}. [[${file}|${note.repo.full_name}]] - agent ${note.scores.agent_usefulness_score}, note ${note.scores.note_potential_score}, try ${note.scores.tryability_score}, risk ${note.scores.safety_risk}`;
  })
  .join("\n")}

## Agent Skills

${renderCategoryList(notes, ["agent-skills"], 10)}

## MCP / Tooling

${renderCategoryList(notes, ["mcp", "dev-workflow", "local-agent", "full-agent"], 10)}

## Evaluation / Benchmark

${renderCategoryList(notes, ["evaluation", "benchmark"], 10)}

## Memory / RAG

${renderCategoryList(notes, ["memory", "rag"], 10)}

## Quarantine Watch

${renderCategoryList(
  notes.filter((note) => note.scores.safety_risk === "high"),
  ["mcp", "agent-skills", "evaluation", "benchmark", "catalog", "memory", "rag", "local-agent", "full-agent", "agent-rules", "github-automation", "sandbox", "dev-workflow", "obsidian", "unknown"],
  10
)}

## High Note Potential

${renderHighNotePotential(notes)}

## Medium Or High Safety Risk

${notes
  .filter((note) => note.scores.safety_risk !== "low")
  .slice(0, 10)
  .map((note) => `- [[${safeFileName(note.repo.full_name)}|${note.repo.full_name}]] - ${note.scores.safety_risk} (${note.scores.safety_risk_score})`)
  .join("\n") || "- No medium/high risk repositories in this run."}
`;
}

function renderHighNotePotential(notes: RepoNote[]): string {
  const capped = capByOwner(
    notes.filter((note) => note.scores.note_potential_score >= 60),
    10,
    2
  );
  if (!capped.length) return "- No high-potential notes in this run.";
  return capped.map((note) => `- [[${safeFileName(note.repo.full_name)}|${note.repo.full_name}]] (${note.scores.note_potential_score})`).join("\n");
}

function renderCategoryList(notes: RepoNote[], categories: AgentFoodType[], limit: number): string {
  const categorySet = new Set(categories);
  const filtered = notes.filter((note) => note.agentFoodType.some((type) => categorySet.has(type)));
  const capped = capByOwner(filtered, limit, 2);
  if (!capped.length) return "- No matching repositories in this run.";
  return capped.map(renderDigestItem).join("\n");
}

function capByOwner(notes: RepoNote[], limit: number, ownerLimit: number): RepoNote[] {
  const ownerCounts = new Map<string, number>();
  const selected: RepoNote[] = [];
  for (const note of notes) {
    const owner = note.repo.owner.login;
    const count = ownerCounts.get(owner) ?? 0;
    if (count >= ownerLimit) continue;
    selected.push(note);
    ownerCounts.set(owner, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function renderDigestItem(note: RepoNote): string {
  return `- [[${safeFileName(note.repo.full_name)}|${note.repo.full_name}]] - ${note.agentFoodType.join(", ")}; agent ${note.scores.agent_usefulness_score}, note ${note.scores.note_potential_score}, risk ${note.scores.safety_risk}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function safeFileName(fullName: string): string {
  return fullName.replace(/[\\/:*?"<>|]/g, "__");
}

function truncateForNote(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n\n...README excerpt truncated by repo-garden...`;
}

function agentAngle(score: number): string {
  if (score >= 75) return "Strong candidate for agent workflows, tooling, or architecture patterns.";
  if (score >= 45) return "Potentially useful; inspect the README and examples before starring.";
  return "Weak signal so far; keep only if a manual review finds a specific idea.";
}

function noteAngle(score: number): string {
  if (score >= 75) return "Good article seed with enough public context to explain why it matters.";
  if (score >= 45) return "Could become a short note if paired with a hands-on trial.";
  return "Probably better as a reference link than a standalone article.";
}

function tryAngle(score: number): string {
  if (score >= 70) return "Likely runnable from the README with minimal setup.";
  if (score >= 40) return "Some setup clues exist, but expect a little spelunking.";
  return "Treat as research-first until install/run instructions are clearer.";
}

function safetyAngle(risk: SafetyRisk): string {
  if (risk === "high") return "Review code paths carefully before running locally or granting tokens.";
  if (risk === "medium") return "Use a throwaway token or sandbox for first experiments.";
  return "No obvious risk language detected by the MVP heuristic.";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
