# Letterboxd Sync

Sync a Letterboxd RSS diary feed into a Notion-managed database using Notion Workers.

## How It Works

The worker defines one incremental sync capability:

- Sync key: `letterboxdDiarySync`
- Database key: `letterboxdDiary`
- Schedule: `1d`
- Primary key: `Diary Entry ID`

At runtime, the sync reads `LETTERBOXD_USERNAME` from the deployed worker environment, fetches:

```text
https://letterboxd.com/<username>/rss/
```

and upserts each diary RSS item into Notion. The sync does not keep a cursor or custom state, so deploys do not require state migrations.

The managed database schema is:

| Property         | Type      |
| ---------------- | --------- |
| `Title`          | Title     |
| `Diary Entry ID` | Rich text |
| `Diary Entry`    | URL       |
| `Film`           | URL       |
| `Watch Date`     | Date      |
| `Rating`         | Number    |
| `Rewatch`        | Checkbox  |

## Local Setup

Install dependencies:

```shell
npm install
```

For local execution, set the Letterboxd username:

```shell
export LETTERBOXD_USERNAME=<letterboxd-username>
```

Useful checks:

```shell
npm run fmt:check
npm run lint
npm run check
```

## Worker Secrets

The deployed worker must have:

| Name                  | Required | Purpose                         |
| --------------------- | -------- | ------------------------------- |
| `LETTERBOXD_USERNAME` | Yes      | Letterboxd account RSS username |

Set it on the worker:

```shell
ntn workers env set LETTERBOXD_USERNAME=<letterboxd-username>
```

or push it from a local `.env`:

```shell
ntn workers env push
```

## Deploys

Deploy manually:

```shell
ntn workers deploy
```

Trigger a sync manually:

```shell
ntn workers sync trigger letterboxdDiarySync
```

Check status:

```shell
ntn workers sync status letterboxdDiarySync --no-watch
```

## GitHub Actions

The workflow at `.github/workflows/deploy.yml` deploys on every push to `main`.

It:

1. Installs dependencies with `npm ci`
2. Runs formatting, lint, and TypeScript checks
3. Installs `ntn` with `curl -fsSL https://ntn.dev | bash`
4. Writes a temporary `workers.json` to `/tmp/workers.json`
5. Runs `ntn workers deploy`

`workers.json` is intentionally ignored by git. CI reconstructs it from GitHub Actions secrets so the worker identity is available during deploy without committing the local config file.

### GitHub Actions Secrets

Set these repository secrets with `gh secret set`:

| Name                            | Required | Purpose                                    |
| ------------------------------- | -------- | ------------------------------------------ |
| `NOTION_API_TOKEN`              | Yes      | Authenticates the Notion CLI in CI         |
| `NOTION_ENV`                    | Yes      | Notion environment, usually `prod`         |
| `NOTION_WORKERS_CONFIG_VERSION` | Yes      | Workers config file version, currently `1` |
| `NOTION_SPACE_ID`               | Yes      | Target Notion workspace ID                 |
| `NOTION_WORKER_ID`              | Yes      | Target deployed worker ID                  |

Current values, except the API token, came from the local ignored `workers.json`.

Example:

```shell
gh secret set NOTION_ENV --body prod
gh secret set NOTION_WORKERS_CONFIG_VERSION --body 1
gh secret set NOTION_SPACE_ID --body <space-id>
gh secret set NOTION_WORKER_ID --body <worker-id>
gh secret set NOTION_API_TOKEN --body <token>
```

The workflow does not need `LETTERBOXD_USERNAME`; that value belongs to the deployed worker environment and is read only when the sync runs.
