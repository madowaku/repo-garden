import { strict as assert } from "node:assert";
import test from "node:test";
import path from "node:path";
import {
  classifyAgentFoodType,
  getRepoNotePath,
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

test("classifyAgentFoodType returns the strongest rule-based category", () => {
  assert.equal(classifyAgentFoodType(baseRepo, "Persistent memory with RAG retrieval"), "memory");
  assert.equal(classifyAgentFoodType({ ...baseRepo, topics: ["model-context-protocol"] }, "MCP server"), "mcp");
  assert.equal(classifyAgentFoodType({ ...baseRepo, topics: [] }, "AGENTS.md rules for Codex"), "agent-rules");
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

  assert.match(markdown, /agent_food_type: memory/);
  assert.match(markdown, /## なぜ気になった？/);
  assert.match(markdown, /agent_reason:/);
  assert.match(markdown, /note_reason:/);
  assert.match(markdown, /try_reason:/);
  assert.match(markdown, /risk_reason:/);
  assert.match(markdown, /first_seen: 2026-06-01/);
  assert.match(markdown, /last_checked: 2026-06-13/);
});

test("getRepoNotePath routes high risk repos to quarantine", () => {
  const lowPath = getRepoNotePath("vault", "madowaku/safe-agent", "low");
  const highPath = getRepoNotePath("vault", "madowaku/risky-agent", "high");

  assert.equal(lowPath, path.join("vault", "00_Inbox", "madowaku__safe-agent.md"));
  assert.equal(highPath, path.join("vault", "90_Quarantine", "madowaku__risky-agent.md"));
});
