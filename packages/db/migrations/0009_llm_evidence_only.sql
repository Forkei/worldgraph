-- LLM judge verdicts are evidence on the hypothesis, never binding decisions (research 13: LLMs confidently
-- merge and split same-name entities). Only human decisions are records. Existing llm decisions are removed.
DELETE FROM resolution_decisions WHERE method = 'llm';
