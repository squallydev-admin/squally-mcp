// Trust the operating system's certificate store, IN ADDITION to Node's own.
//
// WHY (25.09., 0.1.3): behind antivirus HTTPS scanning (measured: Norton
// Web/Mail Shield on Windows) or a TLS-inspecting corporate proxy, every
// certificate the API presents is re-signed by a root that lives in the
// operating system's store - where browsers find it - and not in Node's
// bundled Mozilla list. fetch then fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE
// and the user sees "fetch failed", while their browser opens the same URL.
//
// THE RULES, each one a decision:
//   - ADD, never replace. The new default list is Node's current default
//     (bundled Mozilla roots, plus NODE_EXTRA_CA_CERTS if set, plus the system
//     store if Node already runs with --use-system-ca) and only then the system
//     certificates it does not already contain, matched by fingerprint - the
//     same root often comes in a different PEM encoding. Everything that
//     connected before still connects.
//   - Verification stays on. This changes which roots are trusted, never
//     whether certificates are checked.
//   - SQUALLY_USE_SYSTEM_CA=0 opts out, leaving Node's defaults untouched.
//   - Visible: startupLine() says what happened, with a count and never a
//     certificate subject.
//
// MECHANISM, from Node's documentation: tls.getCACertificates('system') since
// v22.15.0 / v23.10.0, tls.setDefaultCACertificates since v22.19.0 / v24.5.0.
// Both are needed; on an older Node the store is left alone and the line says
// so, with the flag that works there (--use-system-ca, v22.15.0 / v23.8.0).
// Called before the first request: sessions an agent has already cached are not
// affected by a later change (Node's note on setDefaultCACertificates).
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

/** The two tls functions this needs; absent on a Node that predates them. */
export type CaApi = {
  getCACertificates?: (type?: "default" | "system" | "bundled" | "extra") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

export type SystemCaOutcome =
  | { kind: "disabled" }
  | { kind: "unsupported"; nodeVersion: string }
  | { kind: "failed"; reason: string }
  | { kind: "loaded"; added: number; unparseable: number };

/** SQUALLY_USE_SYSTEM_CA=0 (or false/no/off) opts out; anything else, or unset, opts in. */
export function systemCaDisabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.SQUALLY_USE_SYSTEM_CA?.trim().toLowerCase();
  return value === "0" || value === "false" || value === "no" || value === "off";
}

function fingerprint(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

/**
 * Adds the system store's certificates to Node's default CA list for this
 * process, and reports what it did. Never throws: a store that cannot be read
 * leaves Node's defaults exactly as they were.
 */
export function trustSystemCertificates(
  env: NodeJS.ProcessEnv,
  api: CaApi = tls as CaApi,
  nodeVersion: string = process.version,
): SystemCaOutcome {
  if (systemCaDisabled(env)) return { kind: "disabled" };
  if (typeof api.getCACertificates !== "function" || typeof api.setDefaultCACertificates !== "function") {
    return { kind: "unsupported", nodeVersion };
  }

  try {
    const current = api.getCACertificates("default");
    const trusted = new Set(current.map(fingerprint));
    const additions = new Map<string, string>();
    let unparseable = 0;

    for (const pem of api.getCACertificates("system")) {
      let id: string;
      try {
        id = fingerprint(pem);
      } catch {
        // One odd entry in a system store must not cost the other hundred:
        // setDefaultCACertificates refuses the whole list if one fails to parse.
        unparseable += 1;
        continue;
      }
      if (!trusted.has(id) && !additions.has(id)) additions.set(id, pem);
    }

    // Node's current list first and unchanged; only new certificates appended.
    if (additions.size > 0) api.setDefaultCACertificates([...current, ...additions.values()]);
    return { kind: "loaded", added: additions.size, unparseable };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The one stderr line at startup. Counts only - no certificate subject. */
export function systemCaLine(outcome: SystemCaOutcome): string {
  switch (outcome.kind) {
    case "loaded":
      return (
        `squally-mcp TLS: trusting the operating system's certificate store in addition to ` +
        `Node's (${outcome.added} certificate${outcome.added === 1 ? "" : "s"} added` +
        (outcome.unparseable > 0 ? `, ${outcome.unparseable} unreadable skipped` : "") +
        `)`
      );
    case "disabled":
      return "squally-mcp TLS: operating system's certificate store disabled by SQUALLY_USE_SYSTEM_CA - Node's bundled certificates only";
    case "unsupported":
      return (
        `squally-mcp TLS: could not load the operating system's certificate store - Node ` +
        `${outcome.nodeVersion} cannot add it at runtime (needs 22.19+ or 24.5+); ` +
        `NODE_OPTIONS=--use-system-ca does the same from 22.15. Using Node's bundled certificates only`
      );
    case "failed":
      return (
        `squally-mcp TLS: could not load the operating system's certificate store ` +
        `(${outcome.reason}) - using Node's bundled certificates only`
      );
  }
}
