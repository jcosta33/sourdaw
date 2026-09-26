/** Bounds of one `analysis.measure` call, shared by its provider schema, its parser and its receipt. */
export const ANALYSIS_MEASURE_MAX_TARGETS = 4;
export const ANALYSIS_MEASURE_MAX_ID_LENGTH = 256;
/** Seconds between the range's start and end beats. */
export const ANALYSIS_MEASURE_MAX_MEASURED_SECONDS = 600;
/** Seconds the offline renderers process, which start at beat 0 whatever the range's start. */
export const ANALYSIS_MEASURE_MAX_RENDERED_SECONDS = 1200;
export const ANALYSIS_MEASURE_MAX_WARNINGS = 8;
export const ANALYSIS_MEASURE_MAX_WARNING_LENGTH = 200;
