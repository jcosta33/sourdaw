import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

import { type ReducedTarget } from './measureProjectScope';
import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { type MeasuredRange } from './resolveMeasuredRange';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];

/** The receipt of a successful project measurement, as `analysis.measure` reports one. */
export function projectMeasurementReceipt(
    input: { callId: string; turn: number; projectRevision: string },
    parsed: Pick<ParsedArguments, 'scope' | 'metrics'>,
    measurement: { range: MeasuredRange; targets: readonly ReducedTarget[]; warnings: readonly string[] }
): ApplicationToolReceipt {
    const { range, targets } = measurement;
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'success',
        revision: input.projectRevision,
        data: {
            kind: 'analysis-measurement',
            schemaVersion: 1,
            scope: parsed.scope,
            sourceRevisionDigest: digest(input.projectRevision),
            range,
            metrics: parsed.metrics,
            targets,
        },
        summary: `Measured ${String(targets.length)} target(s) over beats ${String(range.startBeat)} to ${String(range.endBeat)}.`,
        warnings: [...measurement.warnings],
        error: null,
    };
}
