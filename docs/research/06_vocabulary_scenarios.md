# Research 06 — Vocabulary stress-test across 34 investigation scenarios

*Modeling agent report, 2026-08-30. Question: does the draft core vocabulary (M1_DESIGN §1.3) cover every scenario this tool could be used in? Method: 34 scenarios × 5–8 load-bearing facts (~230 facts), each checked against the draft.*

**Tally.** Draft as-is: ~58% covered, ~22% covered once a qualifier is allowed, ~17% need a new sub-predicate / node type / attribute, ~3% deliberately `candidate:`. After the revision below: **~96% covered**, remainder deliberately `candidate:`.

## Scenarios checked
Counterparty due diligence · journalist on a politician · opposition research · shell company / AML · missing person · self-audit · genealogy / lost relative · academic collaboration · supply-chain / vendor risk · real-estate ownership · cyber threat-actor attribution · art / asset provenance · nonprofit funding flows · procurement corruption · crypto wallet → person · influencer / brand affiliation · litigation history · event attendance networks · dating-safety check · landlord / tenant · corporate interlocks / antitrust · sanctions / PEP screening · sports careers · medical practitioner · local-government networks · religious / club memberships · military service · immigration / visa records · vehicle / vessel / aircraft · IP portfolios · disinformation networks · probate / guardianship · employment background · insurance / claims fraud.

(Full per-scenario fact lists are in the agent transcript; the consolidated result follows.)

## Proposed revised core vocabulary

```
associated_with (root; NOT emittable — extractor must pick a child or candidate:)
├─ part_of {kind: unit|division|series|cluster|fleet|docket}            any→any (same type)
│   ├─ subsidiary_of {share}                                          org→org
│   └─ spinout_from                                                   org→org
├─ located_in {kind: residence|registered_office|hq|branch|site|mailing|birthplace|death_place|
│              venue|custody|flag|port|posting|sighting, tenure: owner|tenant}   any→place; place→place
├─ member_of {role, title, seniority, unit, nominee:bool}              person→org
│   ├─ works_at {department, employment_kind}
│   ├─ board_member {board_role}
│   └─ studied_at {degree, field}
├─ created {role: author|founder|inventor|artist|issuer|organizer}     person|org→org|document|artifact|asset|credential|event
│   ├─ founded                                                        →org      (moved from member_of)
│   └─ authored {role}                                                person|org|account→document
├─ owns {share, kind: legal|beneficial|nominee|trust|lien|assignee}    person|org→org|asset|account
├─ controls {mechanism: management|voting|trustee|operator|custody|signatory}  person|org→org|asset|account
│   └─ manages                                                        (moved from owns)
├─ paid {amount, currency, kind: investment|grant|donation|political_contribution|loan|contract|
│        salary|fee|sponsorship|transfer_fee|licence|claim, round, instrument}   payer→payee   (= old funded)
├─ transacted_with {kind, amount}                                     symmetric
│   └─ supplies {goods, contract_ref}                                 supplier→customer
├─ represents {capacity: counsel|agent|lobbyist|registered_agent|auditor|guardian|executor|trustee|gallery|adjuster}
│                                                                     person|org→person|org
├─ related_to {relation}                                              person→person (family; symmetric default)
│   ├─ parent_of {kind: biological|step|adoptive}                     asymmetric
│   └─ spouse_of {kind: marriage|partnership}                         symmetric, temporal
├─ knows {context}                                                    symmetric
│   └─ follows                                                        account→account
├─ participated_in {role, outcome}                                    any→event|transaction
│   └─ party_to {role: plaintiff|defendant|witness|counsel|judge|court|designated}   →legal_matter
├─ holds {status}                                                     person|org→position|credential
├─ uses_account {verified:bool}                                       person|org→account
├─ mentions {kind: co-occurrence|citation|adverse|promotion, sentiment}   document|account→any
└─ same_as / not_same_as / suggested_link {confidence, basis}         (system)
```
29 predicates + 3 system (draft: 22 + 3). **Added:** `created`, `controls`, `supplies`, `represents`, `parent_of`, `spouse_of`, `follows`. **Removed:** `lives_at` (→ `located_in{kind:residence, tenure}`). **Renamed:** `funded` → `paid`.

**Node types:** person, organization, place, event, document, account, artifact, asset, position, credential, legal_matter, **transaction** (renamed from money_flow). Every node carries `kind`. `account` widened to "any addressable identifier an entity controls": email, phone, handle, domain, IP, wallet. `place` includes street addresses (`kind: address`) so shared addresses become shared nodes.

**Rule amendment:** sub-predicate when direction, domain/range, **or the qualifier schema** differs. (The draft rule as written outlaws `works_at` / `board_member` / `studied_at`.)

## Deliberately `candidate:`
| candidate | parent | scenarios |
|---|---|---|
| `advised` (advisor→student) | knows | academic |
| `competes_with` | associated_with | antitrust |
| `succeeded` (phoenix / successor entity) | associated_with | AML, antitrust |
| `endorsed` | mentions | politics |
| node `topic` | artifact | academic, disinfo |
| attr `physical_description` | person | missing person, dating safety |
| attr `created_on` (account age) | account | disinfo, dating safety |
| attr `language` | document | threat actor, disinfo |

## Qualifier vocabulary
- **Universal on every edge:** `valid_from`, `valid_to`, `date` (point observation: sightings, votes, payments), `source`. An edge with `date` and no `valid_*` is a snapshot; with `valid_*` it is an interval.
- Per-predicate qualifiers as in the tree. Enumerations are open (unlisted `kind` values accepted and reported) but listed ones are canonical.
- `share` (0–100) only on `owns` / `subsidiary_of`, so 50%-rule and beneficial-ownership aggregation traverse exactly those two.

## Attribute keys
| key | node | type | temporal |
|---|---|---|---|
| kind | all | enum | timeless |
| aliases | all | string[] | timeless |
| status | person/org/asset/credential/legal_matter | enum (active, dissolved, deceased, missing, suspended, revoked, open, closed) | snapshot |
| jurisdiction | org/legal_matter/credential | ISO region | timeless |
| legal_form | org | enum (LLC, trust, foundation, plc…) | timeless |
| identifier, platform | account | string | timeless |
| url, published_on | document | url, date | timeless |
| starts_on, ends_on | event | date | timeless |
| outcome | legal_matter/event | string | timeless |
| address, coordinates | place | string, latlon | timeless |
| occupation | person | string | snapshot |
| employee_count, revenue | org | int, money | snapshot |
| registry_id | all | `scheme:value` (LEI, CIK, IMO, NPI, sha256, parcel) | timeless |

Re-typed: `nationality` → interval; `ticker` → interval with exchange scheme; `follower_count` → snapshot; `amount` → transaction/paid only. **Deleted:** `headquarters` (edge), `email` / `phone` / `handle` (account nodes), `licence_number` (registry_id with scheme, on the credential), `title` as node attribute (it's a member_of qualifier — titles per tenure).

## Modeling notes (the tricky cases)
- **Money: edge by default, node when needed.** `paid` is the 80% case. Reify a `transaction` when > 2 parties (intermediary, escrow, mixer), when the flow has identity (tx hash, contract number, invoice), or when it must be a target of `mentions` / `part_of`. Parties attach via `participated_in{role: payer|payee|intermediary}`. Never both.
- **Positions vs tenures.** Default `member_of{role,title,valid_*}` edge. Reify `position` only when the office outlives holders and succession matters ("the 43rd governor"): `position —part_of→ org`, `person —holds→ position`.
- **Shared addresses.** `place{kind:address}` nodes, `part_of`-linked up to city/country. N orgs `located_in` one address = a registered-agent hub — the graph does the shell-company work by itself. Never addresses as strings.
- **Events vs documents.** Event happens (date, place, participants); document records (url, publisher, mentions). A filing is a document `part_of` a legal_matter; a hearing is an event; a post is a document `authored` by an account; a legal_matter is a container with parties and outcome.
- **Accounts vs handles.** Handle = `identifier` of an account node. `same_as` lives between accounts and between persons, never person↔account — that is `uses_account{verified}`.
- **Ownership chains.** `owns{share}` is the only edge carrying share; `subsidiary_of` is a derivation (owns ≥ 50%). `controls` is a sibling, not `owns{kind:control}`, so share aggregation never traverses control edges and trustees/operators/custodians (no share) fit. The one place "qualifier not sub-predicate" is wrong.
- **Legal roles.** `party_to` = participated_in ranged to legal_matter, role broadened to court/judge/counsel. Lawyer→client is `represents` (survives across matters).
- **Family.** `related_to{relation}` symmetric and lossy, for vague sources. `parent_of` is the only asymmetric family edge. `spouse_of` symmetric but temporal — `valid_to` is what a PEP or dating-safety check needs.
- **`associated_with` abuse.** Forbid emitting it bare; the extractor must pick a child or `candidate:<verb>` with a parent — otherwise the root becomes the landfill for every "linked to" sentence.
- **Issuers.** `holds{issuer}` hides an organization in a qualifier. Model as `org —created{role:issuer}→ credential` so "everything licensed by this board" is a query.
- **Sensitive categories** (religion, health, immigration, sexuality): expressible; gated by extraction policy per investigation, not by the schema.

## Flags on the draft
1. `located_in` under `part_of` is wrong (location ≠ mereology) → root level; swallows `lives_at` and `headquarters`.
2. `manages` under `owns` is wrong (managers own nothing) → under `controls`.
3. `founded` under `member_of` mis-parented → under `created`.
4. `funded` / `transacted_with` / `money_flow` are three encodings of one concept → `paid`, `transacted_with`, reified `transaction` with a promotion rule.
5. `party_to` duplicates `participated_in{role}` → keep only as the legal_matter sub-predicate.
6. `holds{issuer}` — entity hidden in a qualifier.
7. `email`, `phone`, `handle`, `headquarters`, `licence_number`, `title` as attributes duplicate nodes/edges/qualifiers → delete.
8. Temporal qualifiers only on `member_of` → make `valid_from/valid_to/date` universal.
9. `registry_id` without scheme is unusable (LEI vs CIK vs IMO collide) → `scheme:value`.
10. The sub-predicate rule outlaws `works_at` etc. → amend to "direction, domain/range, or qualifier schema".
11. `nationality` timeless → interval.
12. `artifact` vs `asset` overlap → `asset` when ownership/value matters (attaches to `owns`), `artifact` when creation/content matters (attaches to `created`); artwork and patents default to `asset`.
