# AGENTS.md

## Project

`repo-garden` is a TypeScript CLI that discovers GitHub repositories useful for AI agent cultivation and writes one Obsidian Markdown note per repository.

## Commands

- Install dependencies: `npm install`
- Type-check: `npm run build`
- Run discovery: `npm run discover`

## Environment

- Copy `.env.example` to `.env`.
- Set `GITHUB_TOKEN` before running discovery.
- Optional overrides:
  - `REPO_GARDEN_CONFIG=config/keywords.yml`
  - `REPO_GARDEN_OUT=vault/00_Inbox`

## Notes

- Generated notes under `vault/00_Inbox/*.md` are local output and are ignored by git by default.
- Keep README fetch failures non-fatal.
- Preserve `first_seen` when refreshing an existing repo note.
- Update `last_checked` on every refreshed repo note.
- Prefer small scoring improvements over large rewrites until the MVP has real output examples.
