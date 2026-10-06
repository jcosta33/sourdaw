import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasurementAdmitter, type MeasurementFailure } from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { type ToolCallResult } from '../models/ToolCallResult';

import { executePreviewMeasurement } from './executePreviewMeasurement';
import { measureProjectScope, type MeasuredRange, type ReducedTarget } from './measureProjectScope';
import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';

type ExecuteAnalysisMeasureInput = {
    call: ToolCallResult;
    callId: string;
    turn: number;
    /** The revision the planning loop read the project at. */
    projectRevision: string;
    /** The sections the loop's project reads report, which a `sectionId` range names. */
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    /** The run's admission of this measurement's renders and reductions; absent outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
    /** What a `preview` subject compiles and grounds its proposal against; absent, previews are unavailable. */
    preview?: Parameters<typeof executePreviewMeasurement>[0]['preview'];
};

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];

function failureReceipt(input: ExecuteAnalysisMeasureInput, failure: MeasurementFailure): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: failure.safeMessage,
        warnings: [],
        error: failure,
    };
}

function successReceipt(
    input: ExecuteAnalysisMeasureInput,
    parsed: ParsedArguments,
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

function read(receipt: ApplicationToolReceipt): AnalysisMeasureRead {
    return { receipt, commands: null, measuredPreview: null };
}

/**
 * Execute one `analysis.measure` call: render the named scope offline at the
 * loop's project revision and reduce each render to objective figures.
 *
 * The receipt carries figures and each render's content address, never
 * samples; the render itself stays in AudioRendering's measurement retention.
 * A `preview` subject renders a proposed list in isolation beside the project
 * and returns, besides the receipt, the commands it measured for a proposal
 * to adopt; a `project` subject returns its receipt alone, as it always has.
 */
export async function executeAnalysisMeasure(input: ExecuteAnalysisMeasureInput): Promise<AnalysisMeasureRead> {
    const parsed = parseAnalysisMeasureArguments(input.call.arguments);
    if (parsed.status === 'invalid') {
        return read(failureReceipt(input, { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: true }));
    }
    const { subject } = parsed.value;
    if (subject.kind === 'preview') {
        if (input.preview === undefined) {
            return read(
                failureReceipt(input, {
                    code: 'preview-unavailable',
                    safeMessage: 'Measuring a proposal preview is unavailable to this run.',
                    retryable: false,
                })
            );
        }
        return executePreviewMeasurement({
            ...input,
            preview: input.preview,
            parsed: parsed.value,
            proposal: subject.proposal,
        });
    }
    const measured = await measureProjectScope(input, parsed.value);
    if (measured.status === 'failed') {
        return read(failureReceipt(input, measured.failure));
    }
    return read(successReceipt(input, parsed.value, measured.measurement));
}
