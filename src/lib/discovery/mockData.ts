/**
 * Compatibility shim for discovery tests.
 *
 * The dataset is synthetic and exists only to exercise grouping, conflict and
 * scale behavior offline. It is not ingested exam data and must never be used
 * as a production content source.
 */
export { DISCOVERED_EXAMS_DATASET } from "./__fixtures__/discoveryFixtures";
