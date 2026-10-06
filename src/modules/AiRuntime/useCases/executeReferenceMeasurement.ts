import { compareAgentReferenceToProject } from '#/modules/AudioAnalysis/useCases';
import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_COMPARE_REFERENCE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasurementAdmitter, type MeasurementFailure } from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { type ToolCallResult } from '../models/ToolCallResult';
import { readAgentReference } from '../stores/agentReferenceStore';

import { measureProjectScope } from './measureProjectScope';
import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';

type ExecuteReferenceMeasurementInput = {
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
};

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type LoadedReference = NonNullable<ReturnType<typeof readAgentReference>>;
type ProjectMeasurement = Extract<Awaited<ReturnType<typeof measureProjectScope>>, { status: 'measured' }>;

/** The arguments this tool takes: `analysis.measure`'s scope, range and metrics, and no subject, proposal or file. */
const REFERENCE_MEASUREMENT_ARGUMENT_KEYS = ['scope', 'range', 'metrics'];

function failureReceipt(input: ExecuteReferenceMeasurementInput, failure: MeasurementFailure): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
        turn: input.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: failure.safeMessage,
        warnings: [],
        error: failure,
    };
}

function read(receipt: ApplicationToolReceipt): AnalysisMeasureRead {
    return { receipt, commands: null, measuredPreview: null };
}

function hasOnlyReferenceMeasurementArguments(argumentsValue: unknown): boolean {
    return (
        typeof argumentsValue === 'object' &&
        argumentsValue !== null &&
        !Array.isArray(argumentsValue) &&
        Object.keys(argumentsValue).every((key) => REFERENCE_MEASUREMENT_ARGUMENT_KEYS.includes(key))
    );
}

/** The reference's figures for the metrics asked, in the order the project's are reported. */
function pickMetrics(
    measurements: LoadedReference['measurements'],
    metrics: ParsedArguments['metrics']
): LoadedReference['measurements'] {
    const picked: LoadedReference['measurements'] = {};
    for (const metricId of metrics) {
        const entry = measurements[metricId];
        if (entry !== undefined) {
            picked[metricId] = entry;
        }
    }
    return picked;
}

/**
 * The receipt names the reference by its opaque id and content address: the file's name and path
 * never leave the store.
 */
function successReceipt(
    input: ExecuteReferenceMeasurementInput,
    reference: LoadedReference,
    parsed: ParsedArguments,
    measured: ProjectMeasurement['measurement']
): ApplicationToolReceipt {
    const { range, targets } = measured;
    const referenceMeasurements = pickMetrics(reference.measurements, parsed.metrics);
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
        turn: input.turn,
        status: 'success',
        revision: input.projectRevision,
        data: {
            kind: 'reference-measurement',
            schemaVersion: 1,
            deltaSign: 'reference-minus-project',
            reference: {
                referenceId: reference.referenceId,
                contentAddress: reference.contentAddress,
                sampleRate: reference.sampleRate,
                frameCount: reference.frameCount,
                channelCount: reference.channelCount,
                durationSeconds: reference.durationSeconds,
            },
            scope: parsed.scope,
            sourceRevisionDigest: digest(input.projectRevision),
            range,
            metrics: parsed.metrics,
            referenceMeasurements,
            targets: targets.map(({ measurements, ...target }) => ({
                ...target,
                project: measurements,
                deltas: compareAgentReferenceToProject({ project: measurements, reference: referenceMeasurements }),
            })),
        },
        summary: `Compared the reference to ${String(targets.length)} target(s) over beats ${String(range.startBeat)} to ${String(range.endBeat)}. Deltas are reference minus project.`,
        warnings: [...measured.warnings],
        error: null,
    };
}

/**
 * Execute one `analysis.compareReference` call: measure the project scope the way `analysis.measure`
 * does and set it beside the figures measured from the reference the user loaded.
 *
 * The receipt carries the reference's figures, the project's, and `reference − project` deltas. It
 * names the reference by id and content address only, so neither the file, its name nor any audio
 * reaches the planner, and the reference itself was dropped once it was measured.
 */
export async function executeReferenceMeasurement(
    input: ExecuteReferenceMeasurementInput
): Promise<AnalysisMeasureRead> {
    const reference = readAgentReference();
    if (reference === null) {
        return read(
            failureReceipt(input, {
                code: 'no-reference-loaded',
                safeMessage: 'The user has loaded no reference to compare to.',
                retryable: false,
            })
        );
    }
    if (!hasOnlyReferenceMeasurementArguments(input.call.arguments)) {
        return read(
            failureReceipt(input, {
                code: 'invalid-arguments',
                safeMessage: `${ANALYSIS_COMPARE_REFERENCE_TOOL_NAME} accepts only scope, range and metrics.`,
                retryable: true,
            })
        );
    }
    const parsed = parseAnalysisMeasureArguments(input.call.arguments, ANALYSIS_COMPARE_REFERENCE_TOOL_NAME);
    if (parsed.status === 'invalid') {
        return read(failureReceipt(input, { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: true }));
    }
    const measured = await measureProjectScope(input, parsed.value);
    if (measured.status === 'failed') {
        return read(failureReceipt(input, measured.failure));
    }
    return read(successReceipt(input, reference, parsed.value, measured.measurement));
}
