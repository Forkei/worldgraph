// Question persistence + indicator templates. The dispatcher (missions.ts) reads open questions.
import { query } from "@worldgraph/db";
import { uuidv7 } from "@worldgraph/core";
import type { CompiledQuestion, Indicator } from "./compile.ts";

export interface QuestionRow {
  id: string; investigation_id: string; subject_entity_id: string | null; sought: string;
  indicators: Indicator[]; kill_criterion: string | null; stop_rule: Record<string, unknown>; status: string; compiled_by: string | null;
}

export async function saveQuestion(investigationId: string, subjectEntityId: string | null, q: CompiledQuestion, compiledBy: string): Promise<QuestionRow> {
  const id = uuidv7();
  const rows = await query<QuestionRow>(
    `INSERT INTO questions (id, investigation_id, subject_entity_id, sought, indicators, kill_criterion, stop_rule, compiled_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, investigationId, subjectEntityId, q.sought, JSON.stringify(q.indicators), q.kill_criterion, JSON.stringify(q.stop_rule), compiledBy],
  );
  return rows[0]!;
}

export async function openQuestions(investigationId: string): Promise<QuestionRow[]> {
  return query<QuestionRow>(`SELECT * FROM questions WHERE investigation_id=$1 AND status='open' ORDER BY created_at`, [investigationId]);
}

export async function indicatorTemplates(subjectType: string): Promise<Indicator[]> {
  return query<Indicator>(`SELECT name, predicates, record_classes, weight FROM indicator_templates WHERE subject_type=$1 ORDER BY weight DESC`, [subjectType]);
}
