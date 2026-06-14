# repo-garden

GitHubからAIエージェント育成に役立ちそうなリポジトリを発掘し、Obsidian用Markdownとして `vault/00_Inbox` に保存するCLIです。`safety_risk` が `high` のrepoは `vault/90_Quarantine` に隔離します。

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

検索クエリは `config/keywords.yml` で管理します。既存repoは同じMarkdownを更新し、重複作成せず `first_seen` と `manual_review` を保持して `last_checked` を更新します。最後にカテゴリ別セクション付きの `vault/00_Inbox/weekly_digest.md` を生成します。digestでは同じownerが上位を占めすぎないよう、各リストでownerごとに最大2件まで表示します。

`manual_review` の `status` が `article_candidate` のrepoは、追加で `vault/03_NoteSeeds` に1 repo 1記事種Markdownを生成します。記事種には仮タイトル案、ひとことで、repo概要、AIエージェントへの効き方、Madowaku的に面白いところ、注意点、note記事の構成案を含めます。

## Scores

- `agent_usefulness_score`: AIエージェント開発・運用への有用度
- `note_potential_score`: note記事にしやすい度
- `freshness_score`: 最近の更新度
- `tryability_score`: すぐ試せそうか
- `safety_risk`: low / medium / high
- `madowaku_interest_match`: Madowaku文脈との一致度

## Agent Food Type

各repoには配列形式の `agent_food_type` を付けます。

- `mcp`
- `agent-skills`
- `evaluation`
- `benchmark`
- `catalog`
- `memory`
- `rag`
- `local-agent`
- `full-agent`
- `agent-rules`
- `github-automation`
- `sandbox`
- `dev-workflow`
- `obsidian`
- `unknown`

## Manual Review

各repo noteには人間用の `manual_review` セクションがあります。既存noteを更新しても、このセクションは上書きせず保持します。

```markdown
## manual_review

status: unknown
reviewer_note:
```

`status` は次のいずれかです。

- `keep`
- `maybe`
- `reject`
- `article_candidate`
- `tried`
- `unknown`

`article_candidate` は `weekly_digest.md` の最上位セクションに表示されます。`reject` はnote自体を残したまま、次回digestから除外されます。
