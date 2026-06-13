# repo-garden

GitHubからAIエージェント育成に役立ちそうなリポジトリを発掘し、Obsidian用Markdownとして `vault/00_Inbox` に保存するCLIです。

## Setup

```bash
npm install
cp .env.example .env
```

`.env` の `GITHUB_TOKEN` にGitHub personal access tokenを設定してください。public repo検索だけならclassic tokenの広い権限は不要です。

## Run

```bash
npm run discover
```

検索クエリは `config/keywords.yml` で管理します。既存repoは同じMarkdownを更新し、重複作成せず `last_checked` を更新します。最後に `vault/00_Inbox/weekly_digest.md` を生成します。

## Scores

- `agent_usefulness_score`: AIエージェント開発・運用への有用度
- `note_potential_score`: note記事にしやすい度
- `freshness_score`: 最近の更新度
- `tryability_score`: すぐ試せそうか
- `safety_risk`: low / medium / high
- `madowaku_interest_match`: Hiro / Madowaku文脈との一致度
