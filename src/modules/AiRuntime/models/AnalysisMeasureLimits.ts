/** Bounds of one `analysis.measure` call, shared by its provider schema, its parser and its receipt. */
export const ANALYSIS_MEASURE_MAX_TARGETS = 4;
export const ANALYSIS_MEASURE_MAX_ID_LENGTH = 256;
export const ANALYSIS_MEASURE_MAX_WARNINGS = 8;
export const ANALYSIS_MEASURE_MAX_WARNING_LENGTH = 200;
/** The shortest wall-clock allowance a measurement gets, whatever its range, so a short range still renders. */
export const ANALYSIS_MEASURE_MIN_WALL_CLOCK_MS = 10_000;
/** Wall-clock milliseconds allowed per rendered second: four times real time. */
export const ANALYSIS_MEASURE_WALL_CLOCK_MS_PER_RENDERED_SECOND = 4_000;
