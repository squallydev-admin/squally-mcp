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
// Exported as `squally-mcp/instructions` (package.json), so it stays a plain
// constant - test/exports.test.js imports it through the package name.
export const INSTRUCTIONS = [
  "Start with squally-list-projects; every other tool needs a projectId from it.",
  "For one test, use squally-get-test-metrics, not squally-list-tests.",
  "Test metrics count completed CI runs in the period, without runs where most of the",
  "suite failed at once; local runs never count. stability = runs that passed on the",
  "first try / runs; flakyRate = runs that passed only after a retry / runs;",
  "failureRate = failed runs / runs. There is no verdict: the tools return numbers,",
  "and you judge them. If a test name is ambiguous, repeat with filePath from the",
  "error. Errors carry a code and an action; follow the action.",
].join(" ");
