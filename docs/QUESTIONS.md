# Questions for the maintainer

*2026-08-29. Answer in the next voice memo — each one changes something concrete in the design. Defaults I've assumed are in brackets.*

1. **Who is the first user?** You alone, a client's research intern, journalists & due-diligence analysts, or a product to sell? This decides whether M3 (governance, multi-tenant) comes before or after M4/M5. [default: analyst/journalist product, you as user zero]

2. **Whose project is it?** Built inside a client engagement (the client's IP) or your own thing that happens to bridge to an external system? This decides whether the canonical graph *must* be the client system or can be ours. [default: yours; the client system as sync target]

3. **Private individuals — in or out for v1?** Your example was a random middle-school teacher. My design allows it only under `self_audit`, `consented_subject`, or `licensed_investigator`; everyone else gets public figures, organizations, and professional context with residence/family redacted. Do you accept that, or do you want the unrestricted mode as a default for your own workspace? [default: restricted, unlocked per workspace]

4. **Do you accept "own the graph, sync to the client system"?** The alternative is client-system-as-store, which means no dated/money/directional edges, daily rebuilds, and no live frontier. [default: own it]

5. **Shared world graph or isolated investigations?** Your "next level: the United States" idea = a persistent workspace-level entity registry that every investigation merges into. Default on (so coverage accumulates) or default off (cleaner, safer)? [default: on for your workspace, off for others]

6. **How autonomous by default?** Fully auto within budget, or approve-each-hop? Related: what's a normal investigation for you — 50 pages / $2, or 500 pages / $20? [default: auto, 300 pages / $8 / 3 hops]

7. **Canvas priority.** The Iron-Man visual is in M1, but a real WebGL canvas with layouts is a lot of front-end. Would you accept CLI + MCP + a basic canvas through M5 and the polished canvas in M7? [default: basic canvas in M1, polish in M7]

8. **Stack sign-off.** TypeScript everywhere; single Postgres (pgvector + AGE) instead of Neo4j; pg-boss instead of Redis/Temporal; Next.js + sigma.js for the web app. Any of these you'd veto?

9. **Spend.** Search API (Brave ≈ $5/1k queries), Firecrawl, proxies for headless fetch, Voyage embeddings, Claude. What monthly ceiling should the design assume during build? [default: ≤ $300/mo]

10. **Legal posture.** You're in France, so GDPR makes you the controller for any EU subject. Comfortable proceeding with the legal-basis + erasure design, or do you want an EU-subjects-excluded mode until there's counsel? [default: proceed with the design as specified]

11. **Time.** The plan is ~13.5 weeks of focused build. With other commitments, is that 13 calendar weeks or 25? Affects how aggressively I should cut M4/M7. [default: assume ~half-time → ~6 months]

12. **Reuse.** Should the campaign-intel intern's ~17 connector tools and the `loader/` pipeline be lifted into this repo, or rewritten clean? [default: lift, then refactor]

13. **Name.** Is "WorldGraph" the name, or a working title?

## Answers — 2026-08-29 (the maintainer)

1. Built for me; could be for others.
2. My project. Maybe for the client system later — if it really is OP it would be silly to give it away for free.
3. Yes — private individuals are not out of the question; interesting, even.
4. Own the graph, yes. Client-system sync: not for now, that's going to be tough.
5. "What do you mean on for me, off for others?" → to be explained and decided (open).
6. For now we choose each hop; otherwise auto within budget.
7. No — building bit by bit. Canvas near the end; polish at the end.
8. Good. I want power and flexibility.
9. Yes, ~$300/month is fine.
10. Want to talk through this and learn (open).
11. Don't care about time.
12. No reuse — scratch. Our own project, no lifting parts.
13. WIP name, but yes.
+ Keep a repo and keep things up to date with commits. Work clean and organized.

Folded into `PRODUCT_SPEC.md` §9 (decisions log) and the reordered `BUILD_PLAN.md` the same day.

## Parked 2026-08-31 — extraction (stage-3 review; the maintainer wants to answer these later)
1. Extraction has no measured precision/recall — start with a 50-claim labelled sample from the three seeds?
2. Agent-as-reader: whole page in context (no chunks) — confirmed direction; how much context does the reader get beyond the page (mission, subgraph digest)?
3. Claims-while-reading: keep the registry-compiled JSON schema as the guardrail, or loosen it for agents? (My strong view: keep it.)
4. Qualifier keys (role/title/unit…) are uncontrolled vocabulary — normalize them in the registry like predicates?
5. Mention hints carry the identity keys unaudited — should the reader be asked to justify each hard key (where on the page it saw it)?
6. extractor_conf_raw is stored and unused — drop the column or prove it correlates with error?
