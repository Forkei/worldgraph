// Governance hook (L1). M0 ships only `unrestricted`; M5 adds real policies. The pipeline calls
// `policy.redact(claim)` before every insert, so later policies plug in without rewiring.
import type { Claim } from "./claims.ts";

export type RedactDecision = { action: "keep" } | { action: "redact"; reason: string };

export interface Policy {
  readonly name: string;
  /** Called before a claim is persisted. */
  redact(claim: Claim): RedactDecision;
}

export const unrestricted: Policy = {
  name: "unrestricted",
  redact: () => ({ action: "keep" }),
};

const POLICIES: Record<string, Policy> = { unrestricted };
export function getPolicy(name: string): Policy {
  const p = POLICIES[name];
  if (!p) throw new Error(`unknown policy: ${name}`);
  return p;
}
