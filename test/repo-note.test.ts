import { strict as assert } from "node:assert";
import test from "node:test";
import path from "node:path";
import {
  classifyAgentFoodType,
  extractManualReview,
  getRepoNotePath,
  renderDigest,
  renderRepoNote,
  scoreRepo,
  type GitHubRepo,
  type RepoNote
} from "../src/index.ts";

const baseRepo: GitHubRepo = {
  id: 1,
  name: "agent-memory",
  full_name: "madowaku/agent-memory",
  html_url: "https://github.com/madowaku/agent-memory",
  description: "Memory and RAG tools for coding agents",
  stargazers_count: 123,
  forks_count: 7,
  open_issues_count: 2,
  language: "TypeScript",
  topics: ["ai-agent", "memory", "rag"],
  pushed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_at: "2026-01-01T00:00:00Z",
  archived: false,
  disabled: false,
  license: { spdx_id: "MIT", name: "MIT License" },
  owner: {
    login: "madowaku",
    html_url: "https://github.com/madowaku"
  }
};

test("classifyAgentFoodType returns all matching rule-based categories", () => {
  assert.deepEqual(classifyAgentFoodType(baseRepo, "Persistent memory with RAG retrieval"), ["memory", "rag"]);
  assert.deepEqual(
    classifyAgentFoodType(
      {
        ...baseRepo,
        name: "mcp-catalog",
        full_name: "tools/mcp-catalog",
        description: "Awesome MCP server catalog",
        topics: ["model-context-protocol"]
      },
      "Awesome MCP server catalog"
    ),
    ["mcp", "catalog"]
  );
  assert.deepEqual(
    classifyAgentFoodType(
      {
        ...baseRepo,
        name: "agent-rules",
        full_name: "rules/agent-rules",
        description: "AGENTS.md rules for Codex skills",
        topics: []
      },
      "AGENTS.md rules for Codex skills"
    ),
    ["agent-skills", "agent-rules"]
  );
});

test("renderRepoNote includes food type and rule-based reasons", () => {
  const scores = scoreRepo(baseRepo, "Quickstart: npm install. Memory RAG coding agent.");
  const note: RepoNote = {
    repo: baseRepo,
    readme: "Quickstart: npm install. Memory RAG coding agent.",
    discoveredBy: ["agent-memory"],
    scores,
    firstSeen: "2026-06-01",
    lastChecked: "2026-06-13",
    agentFoodType: classifyAgentFoodType(baseRepo, "Quickstart: npm install. Memory RAG coding agent.")
  };

  const markdown = renderRepoNote(note);

  assert.match(markdown, /agent_food_type:\n  - memory\n  - rag/);
  assert.match(markdown, /## なぜ気になった？/);
  assert.match(markdown, /agent_reason:/);
  assert.match(markdown, /note_reason:/);
  assert.match(markdown, /try_reason:/);
  assert.match(markdown, /risk_reason:/);
  assert.match(markdown, /first_seen: 2026-06-01/);
  assert.match(markdown, /last_checked: 2026-06-13/);
});

test("renderRepoNote adds default manual_review section", () => {
  const note = makeNote("review/default", ["dev-workflow"], 72);

  const markdown = renderRepoNote(note);

  assert.match(markdown, /## manual_review/);
  assert.match(markdown, /status: unknown/);
  assert.match(markdown, /reviewer_note:/);
});

test("renderRepoNote preserves existing manual_review section without overwriting reviewer text", () => {
  const note = {
    ...makeNote("review/preserved", ["dev-workflow"], 72),
    manualReview: {
      status: "article_candidate" as const,
      section: "## manual_review\n\nstatus: article_candidate\nreviewer_note: This deserves a note.\n\nExtra human text."
    }
  };

  const markdown = renderRepoNote(note);

  assert.match(markdown, /status: article_candidate/);
  assert.match(markdown, /reviewer_note: This deserves a note\./);
  assert.match(markdown, /Extra human text\./);
});

test("extractManualReview reads status and raw section from existing markdown", () => {
  const markdown = [
    "# repo",
    "",
    "## manual_review",
    "",
    "status: tried",
    "reviewer_note: Ran locally and it works.",
    "",
    "## Scores",
    ""
  ].join("\n");

  const manualReview = extractManualReview(markdown);

  assert.equal(manualReview.status, "tried");
  assert.match(manualReview.section, /reviewer_note: Ran locally/);
});

test("renderDigest adds category sections and caps each owner at two entries per section", () => {
  const notes = [
    makeNote("same/skills-one", ["agent-skills"], 90),
    makeNote("same/skills-two", ["agent-skills"], 80),
    makeNote("same/skills-three", ["agent-skills"], 70),
    makeNote("tools/mcp-kit", ["mcp"], 95),
    makeNote("evals/bench", ["evaluation", "benchmark"], 88),
    makeNote("mem/rag-box", ["memory", "rag"], 86),
    makeNote("risky/sandbox", ["sandbox"], 84, "high")
  ];

  const digest = renderDigest(notes);

  assert.match(digest, /## Agent Skills/);
  assert.match(digest, /## MCP \/ Tooling/);
  assert.match(digest, /## Evaluation \/ Benchmark/);
  assert.match(digest, /## Memory \/ RAG/);
  assert.match(digest, /## Quarantine Watch/);
  assert.match(digest, /\[\[same__skills-one\|same\/skills-one\]\]/);
  assert.match(digest, /\[\[same__skills-two\|same\/skills-two\]\]/);
  assert.doesNotMatch(digest, /\[\[same__skills-three\|same\/skills-three\]\]/);
});

test("renderDigest puts article candidates first and hides rejected repos", () => {
  const article = {
    ...makeNote("writer/good-note", ["catalog"], 70),
    manualReview: {
      status: "article_candidate" as const,
      section: "## manual_review\n\nstatus: article_candidate\nreviewer_note: good article"
    }
  };
  const rejected = {
    ...makeNote("skip/rejected", ["catalog"], 99),
    manualReview: {
      status: "reject" as const,
      section: "## manual_review\n\nstatus: reject\nreviewer_note: not relevant"
    }
  };
  const maybe = {
    ...makeNote("maybe/keep-looking", ["catalog"], 80),
    manualReview: {
      status: "maybe" as const,
      section: "## manual_review\n\nstatus: maybe\nreviewer_note:"
    }
  };

  const digest = renderDigest([rejected, maybe, article]);

  assert.match(digest, /## Article Candidates\n\n- \[\[writer__good-note\|writer\/good-note\]\]/);
  assert.doesNotMatch(digest, /skip\/rejected/);
  assert.match(digest, /maybe\/keep-looking/);
});

function makeNote(fullName: string, agentFoodType: RepoNote["agentFoodType"], agentScore: number, risk = "low"): RepoNote {
  const [owner, name] = fullName.split("/");
  const repo: GitHubRepo = {
    ...baseRepo,
    id: agentScore,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    owner: {
      login: owner,
      html_url: `https://github.com/${owner}`
    }
  };
  return {
    repo,
    readme: "",
    discoveredBy: ["test"],
    scores: {
      ...scoreRepo(repo, ""),
      agent_usefulness_score: agentScore,
      note_potential_score: agentScore,
      safety_risk: risk as RepoNote["scores"]["safety_risk"],
      safety_risk_score: risk === "high" ? 60 : 0
    },
    firstSeen: "2026-06-01",
    lastChecked: "2026-06-13",
    agentFoodType
  };
}

test("getRepoNotePath routes high risk repos to quarantine", () => {
  const lowPath = getRepoNotePath("vault", "madowaku/safe-agent", "low");
  const highPath = getRepoNotePath("vault", "madowaku/risky-agent", "high");

  assert.equal(lowPath, path.join("vault", "00_Inbox", "madowaku__safe-agent.md"));
  assert.equal(highPath, path.join("vault", "90_Quarantine", "madowaku__risky-agent.md"));
});
