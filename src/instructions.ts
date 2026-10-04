// The server's `instructions` - what a client puts in front of the model once,
// before any tool is called (decided 24.09.).
//
// Each sentence prevents one concrete mistake: starting without a projectId
// (which every other tool needs), listing the whole suite to ask about one
// test, reading a rate without knowing what it divides by or which runs it
// counts, reading a verdict into numbers that carry none, guessing at an
// ambiguous test name instead of passing filePath, and ignoring the action the
// API already put in the error.
//
// NO VERDICT SINCE 0.2.0 (API 1.0.0-beta.2): squally-app removed the engine
// that called tests flaky, broken or healthy (25.09.2026). The metrics are
// fractions of runs and nothing more; saying so here stops a model from
// presenting a rate as Squally's judgement.
//
// ONE RUN PER CI RUN SINCE 0.3.0 (API 1.0.0-beta.6): the population is the CI
// runs whose shards all finished, each counted once ("ci_groups_finished_not_
// mass_failure"); it was every completed shard on its own.
//
// RUNS IN PROGRESS SINCE 0.4.0 (API 1.0.0-beta.7): said outright, because the
// newest run is the one an agent asks about, and it is missing from the
// numbers until its last shard has finished.
//
// THE SOURCE SINCE 0.4.0 (API 1.0.0-beta.8): CI runs by default; local runs
// count only when the agent asks for them - they were never counted before.
//
// THE RUN TIMEOUT (API 1.0.0-beta.10, since 0.5.0): a run whose shard died or
// never started counts once the run timeout has passed, with the shards that
// finished - "whose shards all finished" stopped being the whole rule.
//
// THE MONTHLY RESULT LIMIT (API 1.0.0-beta.11, since 0.5.0): a shard the limit
// stopped is treated like a timed-out one, so the sentence names it - and says
// "the results its shards reported", since such a shard did not finish.
//
// ONE RUN STATUS SINCE 0.5.0 (API 1.0.0-beta.14): a run's status is the
// dashboard's own word - passed, failed, cancelled, incomplete or running -
// and the `cancelled` boolean is gone (`cancellation` says how and when). Said
// here because a model that knew the old shape looks for a flag that no longer
// exists, or reads "cancelled" as an unknown value.
//
// Exported as `squally-mcp/instructions` (package.json), so it stays a plain
// constant - test/exports.test.js imports it through the package name.
export const INSTRUCTIONS = [
  "Start with squally-list-projects; every other tool needs a projectId from it.",
  "For one test, use squally-get-test-metrics, not squally-list-tests.",
  "Test metrics count the finished CI runs of the period - a sharded run counts once -",
  "without runs that were a mass failure as a whole; pass source=local or source=all",
  "to count local runs or both. A run still in progress counts once all its shards have",
  "finished, or once the run timeout has passed, with the results its shards reported -",
  "also when a shard was stopped by the monthly result limit.",
  "stability = runs that passed on the",
  "first try / runs; flakyRate = runs that passed only after a retry / runs;",
  "failureRate = failed runs / runs. There is no verdict: the tools return numbers,",
  "and you judge them. If a test name is ambiguous, repeat with filePath from the",
  "error. A run's status is passed, failed, cancelled, incomplete or running.",
  "Errors carry a code and an action; follow the action.",
].join(" ");
