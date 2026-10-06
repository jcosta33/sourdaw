import { compareAgentScopeMeasurements, measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import {
    discardAgentMeasurementArtifacts,
    renderAgentPreviewMeasurementScope,
} from '#/modules/AudioRendering/useCases';
import { previewVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { ANALYSIS_MEASURE_MAX_WARNING_LENGTH, ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import {
    describeMeasurementStop,
    planMeasurementWork,
    type MeasurementAdmitter,
    type MeasurementRun,
} from '../models/MeasurementBudget';
import { type ProjectContext, type ProjectContextSection } from '../models/ProjectContext';
import { type RetainedCommand } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../models/ToolCallResult';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { beginMeasurementRun } from './beginMeasurementRun';
import { compilePreviewMeasurementProposal } from './compilePreviewMeasurementProposal';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';
import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveAnalysisMeasureBeats } from './resolveAnalysisMeasureBeats';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type PreviewRender = Awaited<ReturnType<typeof renderAgentPreviewMeasurementScope>>;
type PreviewRefusal = Extract<PreviewRender, { status: 'refused' }>;
type RenderedPreview = Extract<PreviewRender, { status: 'rendered' }>;
type RenderedTarget = RenderedPreview['baseline']['targets'][number];
type Failure = { code: string; safeMessage: string; retryable: boolean };

type ExecutePreviewMeasurementInput = {
    call: ToolCallResult;
    callId: string;
    turn: number;
    projectRevision: string;
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    /** The run's admission of this measurement's renders and reductions; absent outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
    parsed: ParsedArguments;
    proposal: Readonly<Record<string, unknown>>;
    /** The run's read model, request and authority, which the proposal is compiled and grounded against. */
    preview: {
        context: ProjectContext;
        prompt: string;
        runId: string;
        /** The creative authority admitted so far in the run; read when the call executes. */
        readCreativeAuthority: () => CreativeRequestAuthority | undefined;
    };
};

function failure(input: ExecutePreviewMeasurementInput, reason: Failure): AnalysisMeasureRead {
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: reason.safeMessage,
        warnings: [],
        error: reason,
    };
    return { receipt, commands: null, measuredPreview: null };
}

function refusalFailure(refusal: PreviewRefusal): Failure {
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    const target = refusal.targetId ?? 'master';
    const device = refusal.deviceId ?? 'unknown';
    const document = refusal.subject === 'preview' ? 'the preview' : 'the project';
    const failures: Readonly<Record<PreviewRefusal['code'], Omit<Failure, 'code'>>> = {
        'unknown-target': { safeMessage: `Target ${target} is not in ${document}.`, retryable: true },
        'kind-mismatch': { safeMessage: `Target ${target} is not of the kind this scope names.`, retryable: true },
        'muted-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: a muted contributor would be rendered unmuted.`,
            retryable: false,
        },
        'disabled-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: a disabled contributor builds no live strip.`,
            retryable: false,
        },
        'render-busy': { safeMessage: 'Another offline render is in progress.', retryable: true },
        'stale-revision': {
            safeMessage: 'The project changed while the preview was being measured; read it again before measuring.',
            retryable: true,
        },
        'empty-render': { safeMessage: `The render of ${target} in ${document} holds no audio.`, retryable: false },
        'render-failed': { safeMessage: `The render of ${target} in ${document} failed.`, retryable: false },
        'range-exceeds-ceiling': {
            safeMessage: `In ${document}, a measurement covers at most ${String(measurementMeasuredSeconds)} s and ends within ${String(measurementRenderedSeconds)} s of the project start.`,
            retryable: true,
        },
        'unprojectable-device-state': {
            safeMessage: `The preview cannot be rendered from its own data: device ${device} holds state the render would read from the live project.`,
            retryable: false,
        },
        'unrenderable-preview-device': {
            safeMessage: `The preview cannot be rendered: device ${device} has no loaded instance to render.`,
            retryable: false,
        },
    };
    return { code: refusal.code, ...failures[refusal.code] };
}

function previewFailure(status: 'no-op' | 'rejected' | 'conflicted' | 'failed', reason: string | undefined): Failure {
    if (status === 'no-op') {
        return {
            code: 'preview-unavailable',
            safeMessage: 'The proposal changes nothing to measure.',
            retryable: true,
        };
    }
    return {
        code: 'preview-unavailable',
        safeMessage: `The proposal could not be previewed: ${reason ?? status}`,
        retryable: true,
    };
}

function measureTarget(
    baseline: RenderedTarget,
    preview: RenderedTarget,
    metrics: ParsedArguments['metrics']
): MeasuredPreview['targets'][number] {
    const baselineMeasurements = measureAgentScopeRender(baseline.buffer, metrics);
    const previewMeasurements = measureAgentScopeRender(preview.buffer, metrics);
    return {
        targetId: baseline.targetId,
        targetKind: baseline.targetKind,
        baseline: baselineMeasurements,
        preview: previewMeasurements,
        deltas: compareAgentScopeMeasurements({ baseline: baselineMeasurements, preview: previewMeasurements }),
    };
}

/** Each baseline target beside the same target in the preview; `null` when the two documents rendered different targets. */
function pairTargets(rendered: RenderedPreview): Array<[RenderedTarget, RenderedTarget]> | null {
    const previewById = new Map(rendered.preview.targets.map((target) => [target.targetId, target]));
    const pairs: Array<[RenderedTarget, RenderedTarget]> = [];
    for (const baseline of rendered.baseline.targets) {
        const preview = previewById.get(baseline.targetId);
        if (preview === undefined) {
            return null;
        }
        pairs.push([baseline, preview]);
    }
    return pairs.length === rendered.preview.targets.length ? pairs : null;
}

function boundedWarnings(rendered: RenderedPreview): string[] {
    return [...rendered.baseline.warnings, ...rendered.preview.warnings]
        .slice(0, ANALYSIS_MEASURE_MAX_WARNINGS)
        .map((warning) => warning.slice(0, ANALYSIS_MEASURE_MAX_WARNING_LENGTH));
}

function artifactOf(target: RenderedTarget) {
    return { route: target.route, artifact: target.artifact };
}

function successRead(
    input: ExecutePreviewMeasurementInput,
    rendered: RenderedPreview,
    pairs: ReadonlyArray<[RenderedTarget, RenderedTarget]>,
    measured: {
        beats: MeasuredPreview['range'];
        commands: readonly RetainedCommand[];
        batchContentHash: string;
        targets: MeasuredPreview['targets'];
    }
): AnalysisMeasureRead {
    const { parsed } = input;
    const { commands, batchContentHash, targets } = measured;
    const { startBeat, endBeat, sectionId } = measured.beats;
    const measuredPreview: MeasuredPreview = {
        scope: parsed.scope,
        range: { startBeat, endBeat, sectionId },
        targets,
        batchContentHash,
        revision: input.projectRevision,
    };
    const receipt: ApplicationToolReceipt = {
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
            subject: 'preview',
            scope: parsed.scope,
            sourceRevisionDigest: digest(input.projectRevision),
            range: {
                startBeat,
                endBeat,
                sectionId,
                baselineSeconds: rendered.baseline.rangeSeconds,
                previewSeconds: rendered.preview.rangeSeconds,
            },
            metrics: parsed.metrics,
            targets: targets.map((target, index) => ({
                ...target,
                baselineRender: artifactOf(pairs[index]![0]),
                previewRender: artifactOf(pairs[index]![1]),
            })),
            commands: materializeTransformToolCalls([
                { callId: input.callId, revision: input.projectRevision, commands },
            ]),
        },
        summary: `Measured the proposal preview against the project for ${String(targets.length)} target(s) over beats ${String(startBeat)} to ${String(endBeat)}. Adopt exactly these commands with compiledCallIds ["${input.callId}"].`,
        warnings: boundedWarnings(rendered),
        error: null,
    };
    return { receipt, commands, measuredPreview };
}

function compileProposal(input: ExecutePreviewMeasurementInput) {
    try {
        return compilePreviewMeasurementProposal({
            callId: input.callId,
            proposal: input.proposal,
            context: input.preview.context,
            prompt: input.preview.prompt,
            revision: input.projectRevision,
            runId: input.preview.runId,
            creativeAuthority: input.preview.readCreativeAuthority(),
        });
    } catch (error) {
        return { status: 'rejected' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}

async function renderPreview(
    input: ExecutePreviewMeasurementInput,
    preview: Extract<ReturnType<typeof previewVersionedCommandBatchEnvelope>, { status: 'previewed' }>,
    beats: { startBeat: number; endBeat: number },
    run: MeasurementRun
): Promise<PreviewRender> {
    const { scope } = input.parsed;
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    try {
        return await renderAgentPreviewMeasurementScope({
            scope: scope.kind === 'tracks' || scope.kind === 'buses' ? scope : { kind: 'master' },
            startBeat: beats.startBeat,
            endBeat: beats.endBeat,
            sourceRevision: input.projectRevision,
            rangeCeilings: {
                measuredSeconds: measurementMeasuredSeconds,
                renderedSeconds: measurementRenderedSeconds,
            },
            preview: preview.workspace,
            signal: run.signal,
            onRenderStart: run.countRender,
        });
    } finally {
        preview.resource.release();
    }
}

function renderedAddresses(rendered: RenderedPreview): string[] {
    return [...rendered.baseline.targets, ...rendered.preview.targets].map((target) => target.artifact.contentAddress);
}

/** Render the preview's scope against the live project, then reduce each target's pair of renders. */
async function renderAndReduce(
    input: ExecutePreviewMeasurementInput,
    preview: Extract<ReturnType<typeof previewVersionedCommandBatchEnvelope>, { status: 'previewed' }>,
    measured: { beats: MeasuredPreview['range']; commands: readonly RetainedCommand[]; batchContentHash: string },
    run: MeasurementRun
): Promise<AnalysisMeasureRead> {
    const rendered = await renderPreview(input, preview, measured.beats, run);
    if (rendered.status === 'cancelled') {
        return failure(input, describeMeasurementStop(run.stopReason() ?? 'cancelled'));
    }
    if (rendered.status === 'refused') {
        return failure(input, refusalFailure(rendered));
    }
    const pairs = pairTargets(rendered);
    if (pairs === null) {
        return failure(input, {
            code: 'preview-unavailable',
            safeMessage: 'The project and the preview rendered different targets for this scope.',
            retryable: false,
        });
    }
    const reduction = await reduceMeasuredTargets({
        targets: pairs,
        run,
        reduce: ([baseline, previewTarget]) => measureTarget(baseline, previewTarget, input.parsed.metrics),
    });
    if (reduction.status === 'stopped') {
        // Both documents' renders are already retained; a measurement that reports nothing leaves none behind.
        discardAgentMeasurementArtifacts(renderedAddresses(rendered));
        return failure(input, describeMeasurementStop(reduction.reason));
    }
    return successRead(input, rendered, pairs, { ...measured, targets: reduction.reduced });
}

/**
 * Measure a proposed semantic command list without applying it: compile and ground it as a
 * proposal would be, preview the resulting batch in an isolated workspace, render the scope over
 * the same range for the live project and for that preview, and reduce both to figures and
 * per-metric deltas. The commands measured are returned for the loop to retain under this call id,
 * so a later proposal adopts exactly what was measured. Every refusal is a typed failure receipt,
 * and nothing here writes the live project.
 */
export async function executePreviewMeasurement(input: ExecutePreviewMeasurementInput): Promise<AnalysisMeasureRead> {
    const resolved = resolveAnalysisMeasureBeats(input.parsed.range, input.sections);
    if (resolved.status === 'failure') {
        return failure(input, resolved.failure);
    }
    const compiled = compileProposal(input);
    if (compiled.status === 'rejected') {
        return failure(input, { code: 'preview-proposal-rejected', safeMessage: compiled.reason, retryable: true });
    }
    const preview = previewVersionedCommandBatchEnvelope(compiled.envelope);
    if (preview.status !== 'previewed') {
        return failure(input, previewFailure(preview.status, 'reason' in preview ? preview.reason : undefined));
    }
    const started = beginMeasurementRun({
        admit: input.admit,
        planned: planMeasurementWork({ scope: input.parsed.scope, subject: 'preview' }),
        runSignal: input.signal,
        renderedSeconds: readMeasurementRenderedSeconds(resolved.beats.endBeat),
    });
    if (started.status === 'refused') {
        preview.resource.release();
        return failure(input, started.failure);
    }
    try {
        return await renderAndReduce(
            input,
            preview,
            {
                beats: resolved.beats,
                commands: compiled.commands,
                batchContentHash: digestCommandBatchContent(compiled.envelope),
            },
            started.run
        );
    } finally {
        started.run.settle();
    }
}
