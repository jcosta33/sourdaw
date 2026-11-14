import { type MeasurementFailure } from '../models/MeasurementBudget';

import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { type MeasurementUnit } from './planMetricMeasurementRequests';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];

/** One read of a unit as an `analysis.measure` call would state it, so its receipt reads exactly as one. */
export type MeasurementUnitCall = Pick<ParsedArguments, 'scope' | 'range' | 'metrics'>;

/** A read's range as the tool's `range` argument states it: a named section, or explicit beats. */
function readUnitRangeArgument(range: MeasurementUnit['reads'][number]['range']) {
    if (range.sectionId === null) {
        return { startBeat: range.startBeat, endBeat: range.endBeat };
    }
    return { sectionId: range.sectionId };
}

/** A unit read normalized through the tool's own argument contract: canonical scope, range and metric order. */
export function readMeasurementUnitCall(
    unit: MeasurementUnit,
    read: MeasurementUnit['reads'][number]
): MeasurementUnitCall | MeasurementFailure {
    const parsed = parseAnalysisMeasureArguments({
        scope: unit.scope,
        range: readUnitRangeArgument(read.range),
        metrics: read.metrics,
    });
    if (parsed.status === 'invalid') {
        return { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: false };
    }
    const { scope, metrics } = parsed.value;
    return { scope, range: parsed.value.range, metrics };
}
