// Mission persistence + a v1 scripted executor. A mission's frontier is a search query; executing it runs the
// search, hands the top hits to an ingest callback (fetch→extract, provided by the CLI so plan stays free of
// acquire wiring), and records the verdict. Agents replace the scripted executor in step 4.
import { query } from "@worldgraph/db";
import { uuidv7 } from "@worldgraph/core";
import type { MissionDraft } from "./dispatch.ts";

export interface MissionRow {
  id: string; investigation_id: string; question_id: string | null; objective: string;
  scope: Record<string, unknown>; frontier: string[]; state: string; verdict: string | null; launched_by?: string;
  score: number; score_parts: Record<string, number>; dedupe_key: string | null;
}

export async function saveMissions(investigationId: string, questionId: string | null, drafts: MissionDraft[], launchedBy = "dispatcher"): Promise<MissionRow[]> {
  const out: MissionRow[] = [];
  for (const d of drafts) {
    const rows = await query<MissionRow>(
      `INSERT INTO missions (id, investigation_id, question_id, objective, scope, frontier, score, score_parts, dedupe_key, state, launched_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'proposed',$10)
       ON CONFLICT (investigation_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND state IN ('proposed','running')
       DO UPDATE SET objective=EXCLUDED.objective, frontier=EXCLUDED.frontier, score=EXCLUDED.score, score_parts=EXCLUDED.score_parts
       RETURNING *`,
      [uuidv7(), investigationId, questionId, d.objective, JSON.stringify(d.scope), JSON.stringify(d.frontier), d.score, JSON.stringify(d.score_parts), d.dedupe_key, launchedBy],
    );
    if (rows[0]) out.push(rows[0]);
  }
  return out;
}

export async function proposedMissions(investigationId: string, limit = 50): Promise<MissionRow[]> {
  return query<MissionRow>(`SELECT * FROM missions WHERE investigation_id=$1 AND state='proposed' ORDER BY score DESC LIMIT $2`, [investigationId, limit]);
}

export async function setMissionState(id: string, state: string, verdict?: string, trail?: unknown[]): Promise<void> {
  await query(`UPDATE missions SET state=$2, verdict=COALESCE($3,verdict), trail=COALESCE($4,trail), started_at=COALESCE(started_at, now()), finished_at=CASE WHEN $2 IN ('done','abandoned') THEN now() ELSE finished_at END WHERE id=$1`,
    [id, state, verdict ?? null, trail ? JSON.stringify(trail) : null]);
}
