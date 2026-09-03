// Capability runners (research/17). Pure, self-rate-limited functions that turn one identifier into typed,
// graded facts + pivot-values. Caching (source_cache) and graph integration are orchestrated by the caller.
export * from "./types.ts";
export * from "./domain.ts"; // Cluster A — domain / infrastructure
export * from "./people.ts"; // Cluster B — people / email
export * from "./media.ts"; //  Cluster C — media / geo
export * from "./org.ts"; //    Cluster D — organizations
export * from "./social.ts"; //  Cluster E — social (Apify)
export * from "./toExtraction.ts"; // CapabilityResult → ExtractionOutput (the graph bridge)
export * from "./runners.ts"; //      the runner table shared by the CLI and the pivot engine
