# squally-mcp

A local [MCP](https://modelcontextprotocol.io) server that lets a coding agent
read your [Squally](https://app.squally.dev) data: which CI runs happened, which
tests are flaky, and why a particular test failed.

It runs on your machine over stdio and talks to Squally's read API over HTTPS.
Point Claude Code, Codex, Cursor or Claude Desktop at it and ask "why is
`checkout.spec.ts` failing on main?".

## Read-only, and structurally so

The server issues **HTTP GETs and nothing else**. There is no code path that
writes, and every tool is annotated `readOnlyHint: true`, so a client can run
them without asking you to confirm each one.

It also cannot reach past your own organization: the key is scoped to one
organization, and scoping, plan checks and secret exclusion are all enforced
by the API, not by this client.

## What an agent can see

Worth knowing before you hand a key to an assistant. Through this server an
agent can read:

- your **projects**, their names and stable branches;
- your **CI runs** — commit SHA and message, branch, author, pull request,
  timing, pass/fail counts;
- **per-test results** for a run, including which shard ran what;
- for a failing attempt: the **error message and stack**, the **code snippet**
  — **verbatim source code from your test file** — and the **Copy-for-AI
  prompt**, which carries the same snippet plus an **ARIA snapshot of your
  application at the moment of failure** (whatever was on screen, truncated to
  3000 characters);
- **flakiness verdicts** and how much time each flaky test has cost;
- **error signatures**: failures grouped across runs and branches.

It cannot see screenshots, videos or traces — artifacts are deliberately out of
scope — and it cannot see any key, secret or webhook URL.

The key reaches **every project in the organization**. Create one per machine so
a single revocation does not lock out everything, and revoke it in Settings →
API keys when the machine is retired.

## Setup

You need an **organization read key** (`sqly_ro_…`): Squally → Settings → API
keys → *Create read key*. It is shown once. It is not the same thing as the
project ingest key your Playwright reporter uses — this server refuses that one
by name.

Requires **Node 22 or newer**. Read keys are available from the **Standard**
plan.

### Claude Code

```bash
claude mcp add squally --scope user \
  --env SQUALLY_API_KEY=sqly_ro_your_key_here \
  -- npx -y squally-mcp
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.squally]
command = "npx"
args = ["-y", "squally-mcp"]
env = { SQUALLY_API_KEY = "sqly_ro_your_key_here" }
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "squally": {
      "command": "npx",
      "args": ["-y", "squally-mcp"],
      "env": { "SQUALLY_API_KEY": "sqly_ro_your_key_here" }
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json` — macOS:
`~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\` — then
restart the app:

```json
{
  "mcpServers": {
    "squally": {
      "command": "npx",
      "args": ["-y", "squally-mcp"],
      "env": { "SQUALLY_API_KEY": "sqly_ro_your_key_here" }
    }
  }
}
```

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `SQUALLY_API_KEY` | yes | Organization read key, `sqly_ro_…`. Missing or an ingest key by mistake, and the server exits with one line saying so. |
| `SQUALLY_API_URL` | no | Base URL, default `https://app.squally.dev`. A trailing `/` or `/api/v1` is tolerated. Useful against a local Squally: `http://localhost:3000`. |
| `SQUALLY_USE_SYSTEM_CA` | no | `0` keeps Node's bundled certificates only. |

squally-mcp trusts your operating system's certificate store, like your browser does; set SQUALLY_USE_SYSTEM_CA=0 to use Node's bundled certificates only.

## Troubleshooting

### Claude Desktop

- **The server does not start in time.** The first start through `npx`
  downloads the package, which can take longer than Claude Desktop's 60-second
  start-up limit. Install it once beforehand with `npm install -g squally-mcp`;
  `npx -y squally-mcp` then runs that copy without a download. Update it with
  the same command.
- **Where the log is.** The Microsoft Store build of Claude Desktop writes it to
  `%LOCALAPPDATA%\Claude\logs\mcp-server-squally.log`. Its first lines say which
  Node runs the server and whether it trusts the system's certificate store;
  a request that never arrives is logged there with its cause.
- **Edit the config only while the app is closed.** Quit Claude Desktop
  completely, including from the system tray, before changing
  `claude_desktop_config.json`.

## The tools

| Tool | What it answers | Cost |
|---|---|---|
| `squally-list-projects` | Which projects exist. **Start here** — every other tool needs a `projectId` from it. | cheap |
| `squally-find-run` | Which runs happened — latest, or by branch, commit SHA or status. Counters only. | cheap |
| `squally-get-run` | One run with its per-test rows, across all shards. Which test is red. | cheap |
| `squally-debug-failure` | Every attempt of one test in one run: error, stack, Copy-for-AI prompt. | cheap |
| `squally-get-test-status` | The stored flakiness status of **one** test. | cheap — one lookup |
| `squally-list-flaky-tests` | The ranked flaky/broken list with time lost. | **expensive — one engine pass** |
| `squally-list-errors` | Error signatures in a period: what keeps failing, grouped. | cheap |

For a single test use `squally-get-test-status`, not
`squally-list-flaky-tests` — the tool descriptions say so, and the server
repeats it in its instructions, because the difference is one database lookup
against a pass over the project's recent runs.

## Development

```bash
npm install
npm run build            # tsc, then copy the vendored OpenAPI document into dist/
npm test                 # builds, then runs the suite
npm run vendor:openapi   # re-fetch the API document; review the diff, then re-pin
```

The tool schemas are **derived from Squally's published OpenAPI document**,
vendored at `src/openapi/v1.json` — an input schema is the operation's
parameters, an output schema is its 200 response. Nothing is transcribed by
hand, so the two cannot drift. `test/drift.test.js` compares the vendored copy
against the live document and fails when an operation or parameter has moved;
it skips loudly when offline.

## Releasing

Publishing is **staged**: CI uploads the tarball, a maintainer approves it, and
only then is the version installable. `npm stage publish` never asks for 2FA,
which is what makes it usable from a workflow; the 2FA prompt moves to the
approval step, so a compromised workflow can stage a version but cannot put one
in front of users. Direct `npm publish` is not permitted for this package's
trusted publisher, so this is the only route.

> **0.1.0 is the exception.** It was published by hand with `npm publish`
> before the trusted publisher existed, so it carries no provenance
> attestation. Every version from 0.1.1 on goes through the steps below.

1. **Bump and tag.** The lockfile belongs to the release commit, so let `npm
   version` write both and commit them together:

   ```bash
   npm install            # only if package.json changed by hand
   npm version patch      # or minor / major - writes package.json + lockfile, makes the tag
   git push --follow-tags
   ```

2. **The tag starts the workflow.** `.github/workflows/publish.yml` runs on
   `v*`: it tests, checks that the tag and `package.json` agree, and runs

   ```bash
   npm stage publish --provenance --access public
   ```

   through npm's trusted publishing (OIDC) — no npm token in GitHub secrets.
   `--provenance` attaches a signed statement linking the tarball to that
   workflow run and commit.

3. **Approve the staged version.** On
   [npmjs.com/package/squally-mcp](https://www.npmjs.com/package/squally-mcp) →
   **Staged Packages** → **Approve**, which asks for 2FA. Or from a terminal:

   ```bash
   npm stage list squally-mcp
   npm stage view <stage-id>       # what is in the tarball
   npm stage approve <stage-id>    # also asks for 2FA
   npm stage reject <stage-id>     # if something is wrong
   ```

   Until this step the version exists in the registry but installs nothing.

**Requirements for step 3 on your machine:** npm **11.15.0 or later** and Node
**22.14.0 or higher** ([npm docs](https://docs.npmjs.com/staged-publishing/)).
Node 22 still bundles npm 10.9.9, so check `npm --version` rather than assuming
your Node version brought a new enough npm. The workflow uses Node 24 for the
same reason and fails with that requirement if a runner ever ships an older npm.

## License

MIT
