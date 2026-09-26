# Changelog

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
