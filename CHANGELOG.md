# Changelog

## Unreleased

**No new minimum API version.** 0.4.0 and this work against the read API
1.0.0-beta.9, beta.10 and beta.11 alike: beta.10 and beta.11 changed what the
numbers count, not a field or a value, so no output schema rejects any of
them.

### Changed

- The vendored OpenAPI document is 1.0.0-beta.10. A run whose shard died or
  never started now counts once the run timeout has passed, with the shards
  that finished, like a cancelled run. The output-schema descriptions of
  `population` (all three tools that return it) and `unfinishedRuns`
  (`squally-list-errors`) say so.
- `squally-get-test-metrics`' description and the server instructions say the
  same: a run still in progress counts once all its shards have finished, or
  once the run timeout has passed. They said only the first.
- The vendored OpenAPI document is 1.0.0-beta.11. A shard stopped by the
  monthly result limit is treated like one that timed out: once the run
  timeout has passed, its run counts with the results its shards reported.
  The same output-schema descriptions say so, and so do
  `squally-get-test-metrics`' description and the server instructions, which
  now say "with the results its shards reported" where they said "with the
  shards that finished".

No tool was added or removed, and no input or output schema changed shape.

## 0.4.0 — breaking: requires API 1.0.0-beta.9; local runs on request, errors counted per run

**This version requires the read API 1.0.0-beta.9.** The output schema of
`squally-list-errors` requires `population`, `failedCount`, `flakyCount`,
`massFailureRunCount` and `unfinishedRuns` and no longer has `isNew`, so
against an older API a client that validates structured output (the MCP
SDK's does) rejects its responses; 0.3.0 against beta.9 fails the same way,
the other way round. app.squally.dev serves beta.9.

### Added

- `source` on `squally-get-test-metrics`, `squally-list-tests` and
  `squally-list-errors`: `ci` (the default - what they counted before),
  `local` or `all`. A local run is one no shard reported a CI provider for;
  until now local runs counted nowhere.
- `squally-list-errors`: `population` (`ci_groups_finished`,
  `local_groups_finished` or `all_groups_finished` - mass-failure runs count
  here, unlike in the test metrics), `unfinishedRuns`, and per error
  `failedCount` and `flakyCount` - of the runs and tests the error hit, how
  many ended failed and how many passed after a retry, by the test's final
  attempt across the run's shards - and `massFailureRunCount`.

### Changed

- `population` on `squally-get-test-metrics` and `squally-list-tests` is one
  of `ci_groups_finished_not_mass_failure` (the default, unchanged),
  `local_groups_finished_not_mass_failure` and
  `all_groups_finished_not_mass_failure`. It was the first value alone.
- `squally-list-errors`: `runCount` counts runs, a sharded run once - it
  counted every shard the error appeared in. Every count is over finished
  runs of the source; runs still running or timed out no longer count, and
  local ones only when asked for. `firstSeen` is the earliest such run still
  stored; `unfingerprintedCount` covers the window only.
- The descriptions of `squally-get-test-metrics`, `squally-list-tests` and
  `squally-list-errors` and the server instructions say what `source` does,
  that a run still in progress counts once all its shards have finished, and,
  for errors, what failedCount and flakyCount mean. They said local runs never
  count.
- The vendored OpenAPI document is 1.0.0-beta.9 (beta.7 and beta.8
  included). Changes outside the tools: `/overview` (beta.7, beta.8) and
  `/errors/{fingerprint}`, whose `runs[].runId` is now the run's id as
  `squally-find-run` gives it - neither has a tool.

### Removed

- `squally-list-errors`: `isNew` on every error. Compare `firstSeen` with
  `window.from` instead.

No tool was added or removed.

## 0.3.0 — breaking: requires API 1.0.0-beta.6; a sharded CI run counts once in the test metrics

**This version requires the read API 1.0.0-beta.6.** The output schemas of
`squally-get-test-metrics` and `squally-list-tests` pin `population` to the
new value, so against an older API a client that validates structured output
(the MCP SDK's does) rejects their responses. 0.2.3 against beta.6 fails the
same way, the other way round. app.squally.dev serves beta.6.

### Changed

- `squally-get-test-metrics` and `squally-list-tests`: `population` is
  `"ci_groups_finished_not_mass_failure"`, was `"ci_completed_not_excluded"`.
  Counted are the CI runs of the period whose shards all finished - a sharded
  run counts once, placed in the period by its first shard's start - without
  runs that were a mass failure as a whole. It was every completed shard on
  its own.
- In both tools, `runs`, `stableRuns`, `flakyRuns`, `failedRuns` and the rates
  count per run, however many shards it had. Unchanged for a test that ran in
  one shard per run.
- `recentResults[].runId` is the run's id as `squally-find-run` gives it - one
  per run. It was the id of the shard the test ran in. A test that a
  cancellation interrupted no longer appears as `skipped`.
- Both tools' descriptions and the server instructions say what is counted
  now, and `squally-get-test-metrics` says its recent runs carry the
  `squally-find-run` run id.
- The vendored OpenAPI document is 1.0.0-beta.6. Its new
  `occurrences[].local` and `occurrences[].counted` belong to the test-history
  endpoint, which no tool calls.

No tool was added or removed, and no input schema changed.

## 0.2.3 — vendored API 1.0.0-beta.5: squally-list-tests and squally-get-test-metrics default to 30 days (was 14)

**No new minimum API version.** 0.2.3 works against the read API 1.0.0-beta.4
and beta.5 alike, as 0.2.2 does. The tools leave every default to the API, so
against beta.4 a call without `days` still covers 14 days; against beta.5 it
covers 30.

### Changed

- `squally-list-tests` and `squally-get-test-metrics`: the `days` argument's
  default is `30` in the input schema, where it was `14` - read API
  1.0.0-beta.5 made 30 the default of every endpoint. The allowed values
  (7, 14, 30, 90) are unchanged. To keep the old window, pass `days: 14`.
- The vendored OpenAPI document is 1.0.0-beta.5. It also carries two text-only
  changes the API made under beta.4: the errors tag describes errors rather
  than error signatures, and the error texts and hints name
  "Organization › Read keys" where they said "Settings > API keys".

Changed by the API underneath, with nothing to do in this package:
`squally-debug-failure`'s `copyPrompt` reads "Last 30 days on CI: …" where it
read "Last 14 days on CI: …".

No tool was added or removed, and no other input or output schema changed.

## 0.2.2 — requires API 1.0.0-beta.4; cancelled runs and attempt timeouts

**This version requires the read API 1.0.0-beta.4.** Its output schemas
require the fields that version added, so against an older API a client that
validates structured output (the MCP SDK's does) rejects the responses of
`squally-find-run`, `squally-get-run` and `squally-debug-failure`. 0.2.1 keeps
working against beta.4: it ignores the added fields.

### Changed

- `squally-find-run` (each run) and `squally-get-run` (`run`): `cancelled`
  (boolean) and `cancellation` (`source`, `at`, `byUserId`, or `null`).
  - A cancelled run keeps its `status` - `passed` or `failed`, or `running` /
    `incomplete` while a shard stopped by the same cancel is still open.
    `status` never says `cancelled`.
  - `source` is `reporter`, `cli` or `user`. In the output schema it is a
    plain string, not an enum, so a source added later does not break
    validation.
- `squally-get-run` (each test, its final attempt) and `squally-debug-failure`
  (each attempt): `timedOut` (boolean or `null`) and `timeoutMs` (integer or
  `null`). `null` means the reporter did not say (squally-reporter before
  0.10.0); `timeoutMs` 0 means no limit.
- New descriptions from the API:
  - `commitSha` is the commit the run is reported under - the pushed commit,
    or for a pull request its head;
  - `testedRevision` is the application revision the run was told it
    tested - opt-in, and never the pull request's head;
  - `squally-find-run`'s `sha` argument matches either of the two, and its
    `status` argument matches no cancelled run.
- The vendored OpenAPI document is 1.0.0-beta.4.

Changed by the API underneath, with nothing to do in this package: a
cancelled run's `finishedAt` and `durationMs` end at its latest finished
shard; `squally-debug-failure`'s `copyPrompt` names a timeout ("Timed out at
its N ms limit"); `squally-list-errors` reports `Timeout Issues` for an error
whose example attempt ran into its limit, for results from squally-reporter
0.10.0 on.

No tool was added or removed, and no other input schema changed.

## 0.2.1 — requires API 1.0.0-beta.3; skipped in recentResults

**This version requires the read API 1.0.0-beta.3.** From that version on, a
test's `recentResults` include the runs in which its final attempt was
skipped, with `result` `skipped`. 0.2.0's output schemas allow only `stable`,
`flaky` and `failed`, so a client that validates structured output (the MCP
SDK's does) rejects the response of `squally-get-test-metrics` or
`squally-list-tests` whenever a test's last 20 runs include a skip.

### Changed

- `squally-get-test-metrics` and `squally-list-tests`: in the output schema,
  `recentResults[].result` gains the enum value `skipped`, and it and
  `recentResults` carry the API's new descriptions. A skipped run is shown and
  never counted - not in `runs`, any rate, `timeLostMs`, `branches` or
  `topBranch`.
- `squally-get-test-metrics`' description says its last 20 runs include
  skipped ones, counted nowhere.
- The vendored OpenAPI document is 1.0.0-beta.3. It no longer has
  `GET /projects/{projectId}/flaky`, which no tool has called since 0.2.0.

No input schema and no other tool changed.

## 0.2.0 — breaking: requires Squally API 1.0.0-beta.2

**This version requires the read API 1.0.0-beta.2**, which removed the verdict
engine. Before that API version its two new tools have no endpoint to call;
from it on, the two removed tools have none.

### Removed

- `squally-get-test-status` — the stored flakiness status of one test. Use
  `squally-get-test-metrics`.
- `squally-list-flaky-tests` — the ranked flaky/broken list. Use
  `squally-list-tests`.

### Added

- `squally-list-tests` — `GET /api/v1/projects/{projectId}/tests`: every test
  with a completed CI run in the period, with runs, stability, flaky rate,
  failure rate and time lost. Arguments `days` (7, 14, 30, 90; default 14),
  `search`, `branch`, `browser`, `sort` (`stability`, `flakyRate`,
  `failureRate`, `runs`, `timeLost`; default `stability`), `page` and
  `perPage` (1–100, default 50), passed through unchanged.
- `squally-get-test-metrics` —
  `GET /api/v1/projects/{projectId}/tests/{testName}/metrics`: the same
  numbers for one test. Arguments `testName`, `filePath`, `days` and `branch`.
  `runs: 0` with `null` rates is an answer, not an error.

### Changed

- The metrics are fractions of runs and nothing more: stability = runs that
  passed on the first try ÷ runs, flakyRate = runs that passed only after a
  retry ÷ runs, failureRate = failed runs ÷ runs, over the completed CI runs of
  the period without mass-failure runs and never local runs. The tool
  descriptions and the server instructions say so, and say that there is no
  verdict.
- `squally-find-run` and `squally-get-run` count `flaky` where they counted
  `recovered`.
- `squally-find-run` and `squally-list-errors` accept `days: 14`.
- An `ambiguous_test` error lists the `filePath` values to retry with, a test
  with no file as `""`.

### Fixed

- An empty `filePath` is sent (`?filePath=`), so it reaches a test with no
  file instead of being dropped — in `squally-debug-failure` as well.
