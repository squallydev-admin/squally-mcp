# Releasing squally-mcp

The flow as it ran for 0.11.0 (24.11.2026). Three places get the version:
npm (via `publish.yml`, staged), npm's approval (a person, 2FA), and the
official MCP Registry as `dev.squally/mcp` (by hand, from this machine).
Nothing here runs on a push to `main`; `ci.yml` only tests.

Never print a key or token in any of these steps - name the variable or the
file, not its value.

## 0. Before the tag

In `C:\Test-Dashboard-SaaS\squally-mcp`, on `main`, with the release commit
merged:

- The version is the same in `package.json`, `package-lock.json` (run
  `npm install` once - `npm version` does not write the lockfile, see
  AGENTS.md) and both `version` fields of `server.json` (the server's and
  `packages[0]`'s). `CHANGELOG.md` has its entry.
- After a re-vendor (`npm run vendor:openapi`) the digest in
  `test/tools.test.js` is re-pinned in the same commit.
- `npm test` is green, including `test/drift.test.js` against the live API
  (it is red while squally-app has not shipped what the vendored document
  describes - ship the app first). `npm pack --dry-run` shows the new version
  and only `dist/`, `README.md`, `LICENSE`, `package.json`.

## 1. Tag - this starts the npm publish

```powershell
cd C:\Test-Dashboard-SaaS\squally-mcp
git switch main
git pull --ff-only
git log -1 --oneline        # the commit that carries the new version
git tag -a v0.11.0 -m "release: 0.11.0 (<one line>)"
git push origin v0.11.0
```

A tag `v*` runs `.github/workflows/publish.yml`: `npm ci`, `npm test`, the
tag must equal `package.json`'s version, then
`npm stage publish --provenance --access public` (trusted publishing over
OIDC - no npm token in the repository's secrets).

Check: `gh run list -w publish.yml -L 1` is green and its log ends with
"Staged v0.11.0. It is NOT installable yet." `npm view squally-mcp version`
still shows the previous version - correct at this point.

## 2. Approve on npm - 2FA

The trusted publisher allows `npm stage publish` only; a staged version is in
the registry but not installable until a maintainer approves it.

- npmjs.com -> squally-mcp -> Staged Packages -> the version -> Approve
  (asks for 2FA), or, signed in as a maintainer:

```powershell
cd C:\Test-Dashboard-SaaS\squally-mcp
npm stage list squally-mcp
npm stage approve <stage-id>
```

Check: `npm view squally-mcp version` and `npm view squally-mcp dist-tags`
show the new version as `latest`.

## 3. MCP Registry - `dev.squally/mcp`, by hand

After step 2: the registry checks the npm package (its `mcpName`,
`dev.squally/mcp`) against `server.json`.

- Tool: `$env:USERPROFILE\tools\mcp-publisher.exe`, version 1.8.9 (not on
  PATH). Releases: github.com/modelcontextprotocol/registry.
- Auth: DNS for the namespace `dev.squally` - a TXT record on `squally.dev`,
  `v=MCPv1; k=ed25519; p=<public key>`. The private key is the Ed25519 key in
  `C:\Test-Dashboard-SaaS\baseline\mcp-registry-key.pem` (outside every repo,
  with the other secrets); mcp-publisher wants it as hex, converted with
  Git's openssl (not on PATH either) into an environment variable that is
  removed right after the login.

```powershell
# validate
cd C:\Test-Dashboard-SaaS\squally-mcp
& $env:USERPROFILE\tools\mcp-publisher.exe validate .\server.json

# login - the key only in MCP_PRIVATE_KEY, removed afterwards
cd C:\Test-Dashboard-SaaS\squally-mcp
$openssl = "C:\Program Files\Git\usr\bin\openssl.exe"
$env:MCP_PRIVATE_KEY = ((& $openssl pkey -in C:\Test-Dashboard-SaaS\baseline\mcp-registry-key.pem -noout -text | Select-String '^priv:' -Context 0,3).Context.PostContext -join '') -replace '[\s:]',''
& $env:USERPROFILE\tools\mcp-publisher.exe login dns --domain squally.dev --private-key $env:MCP_PRIVATE_KEY
Remove-Item Env:MCP_PRIVATE_KEY

# publish, then drop the saved registry login
cd C:\Test-Dashboard-SaaS\squally-mcp
& $env:USERPROFILE\tools\mcp-publisher.exe publish
& $env:USERPROFILE\tools\mcp-publisher.exe logout
```

Check: the login says "Successfully logged in" (it prints the expected
`v=MCPv1; k=ed25519; p=...` line - the public key, the same value as in DNS);
the publish says "Successfully published". Then:

```powershell
curl.exe -s "https://registry.modelcontextprotocol.io/v0/servers?search=dev.squally/mcp"
```

shows `dev.squally/mcp` with the new version, status `active`, `isLatest`
true.

If the login fails: the hex key must be 64 characters
(`$env:MCP_PRIVATE_KEY.Length` before the `Remove-Item`).

## 4. After the release

- squally-docs: bump the devDependency `squally-mcp` to the new version
  (`npm install --save-dev --save-exact squally-mcp@<version>`), build - the
  MCP server page's tool table is read from the published package.
- Delete the merged release branch here, locally and on origin.
