import { ANALYSIS_MEASURE_MAX_WARNING_LENGTH, ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';

/** At most the receipt's warning count, each cut to the receipt's warning length. */
export function boundedMeasurementWarnings(warnings: readonly string[]): string[] {
    return warnings
        .slice(0, ANALYSIS_MEASURE_MAX_WARNINGS)
        .map((warning) => warning.slice(0, ANALYSIS_MEASURE_MAX_WARNING_LENGTH));
}
