# Repo Garden Article Seeds

## Goal

Grow repo-garden from repository discovery into a review-driven writing pipeline.

## Classification

specific

## Current Tranche

Implement the fifth farm: generate one Obsidian Markdown note seed per repository whose `manual_review` status is `article_candidate`.

## Non-Negotiable Constraints

- Preserve existing repo notes and their `first_seen`, `last_checked`, and `manual_review` behavior.
- Do not include `reject` repositories in note seed generation.
- Keep generation rule-based; do not call external AI APIs.
- Verify with tests and TypeScript build before completion.

## Later Farm Candidates

- Sixth farm: capture tried execution logs, impressions, and errors for `status: tried`.
- Seventh farm: generate weekly harvest summaries with rejects and article candidates.
- Eighth farm: tune `scoring_rules.yml` from reject reasons and article candidate patterns.
- Ninth farm: add Obsidian Canvas / Dataview outputs for category visualization.

## Starter Command

`/goal Follow docs/goals/repo-garden-article-seeds/goal.md through the first safe verified implementation slice. Do not stop after planning unless blocked.`
