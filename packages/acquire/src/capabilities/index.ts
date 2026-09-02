// Capability runners (research/17). Pure, self-rate-limited functions that turn one identifier into typed,
// graded facts + pivot-values. Caching (source_cache) and graph integration are orchestrated by the caller.
export * from "./types.ts";
export * from "./domain.ts"; // Cluster A — domain / infrastructure
export * from "./people.ts"; // Cluster B — people / email
export * from "./media.ts"; //  Cluster C — media / geo
