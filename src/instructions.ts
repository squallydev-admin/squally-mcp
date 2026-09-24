// The server's `instructions` - what a client puts in front of the model once,
// before any tool is called (decided 24.09.).
//
// Four sentences, each preventing one concrete mistake: starting without a
// projectId (which every other tool needs), reaching for the expensive ranking
// to ask about one test, guessing at an ambiguous test name instead of passing
// filePath, and ignoring the action the API already put in the error.
export const INSTRUCTIONS = [
  "Start with squally-list-projects; every other tool needs a projectId from it.",
  "For one test, use squally-get-test-status (cheap), not squally-list-flaky-tests",
  "(expensive, one engine pass). If a test name is ambiguous, repeat with filePath",
  "from the error. Errors carry a code and an action; follow the action.",
].join(" ");
