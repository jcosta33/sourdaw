/** Bounds of one `analysis.measure` call, shared by its provider schema, its parser and its receipt. */
export const ANALYSIS_MEASURE_MAX_TARGETS = 4;
/** `analysis.compareReference` carries the reference's, each target's and the delta figures per metric, so four targets with every metric exceed the per-call receipt budget. */
export const ANALYSIS_COMPARE_REFERENCE_MAX_TARGETS = 3;
export const ANALYSIS_MEASURE_MAX_ID_LENGTH = 256;
export const ANALYSIS_MEASURE_MAX_WARNINGS = 8;
export const ANALYSIS_MEASURE_MAX_WARNING_LENGTH = 200;
/** The shortest wall-clock allowance a measurement gets, whatever its range, so a short range still renders. */
export const ANALYSIS_MEASURE_MIN_WALL_CLOCK_MS = 10_000;
/** Wall-clock milliseconds allowed per second any render of a measurement processes: four times real time. */
export const ANALYSIS_MEASURE_WALL_CLOCK_MS_PER_RENDERED_SECOND = 4_000;
