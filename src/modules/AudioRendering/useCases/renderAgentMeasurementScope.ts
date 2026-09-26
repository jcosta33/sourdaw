import { renderAgentMeasurementTarget, resolveAgentMeasurementTargets } from '#/modules/Arrangement/useCases';
import { cancelExport, isExportActive, renderOffline, resetCancelFlag } from '#/modules/AudioEngine/useCases';
import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { retainAgentMeasurementArtifacts } from './retainAgentMeasurementArtifacts';

/**
 * The master mixdown renders at this rate; an isolated track or bus renders at
 * the live context's rate. Every measured metric is defined in physical units
 * (LUFS, dBTP, Hz, ratios), so figures stay comparable across routes whose
 * render rates differ.
 */
const ANALYSIS_MEASURE_MIXDOWN_SAMPLE_RATE = 48_000;

type MeasurementScope = Parameters<typeof resolveAgentMeasurementTargets>[0];
type ResolvedTargets = Extract<ReturnType<typeof resolveAgentMeasurementTargets>, { status: 'resolved' }>;
type MeasurementTarget = ResolvedTargets['targets'][number];

type RenderAgentMeasurementScopeInput = {
    scope: MeasurementScope;
    startBeat: number;
    endBeat: number;
    /** The revision the caller read the project at; every render must still describe it. */
    sourceRevision: string;
    signal?: AbortSignal;
};

type RenderedMeasurementTarget = {
    targetId: string;
    targetKind: MeasurementTarget['targetKind'];
    route: 'mixdown' | 'isolated-subgraph';
    liveAudibility: MeasurementTarget['liveAudibility'];
    buffer: AudioBuffer;
    artifact: {
        contentAddress: string;
        sampleRate: number;
        frameCount: number;
        channelCount: number;
        durationSeconds: number;
    };
};

type MeasurementScopeRefusalCode =
    | Extract<ReturnType<typeof resolveAgentMeasurementTargets>, { status: 'refused' }>['code']
    | 'render-busy'
    | 'stale-revision'
    | 'empty-render'
    | 'render-failed';

type RenderAgentMeasurementScopeResult =
    | {
          status: 'rendered';
          soloActive: boolean;
          targets: RenderedMeasurementTarget[];
          /** Renderer warnings, then one line per render too large to retain. */
          warnings: string[];
      }
    | {
          status: 'refused';
          code: MeasurementScopeRefusalCode;
          targetId: string | null;
          contributorId: string | null;
      }
    | { status: 'cancelled' };

type TargetRenderOutcome =
    { status: 'buffer'; buffer: AudioBuffer | null } | { status: 'failed' } | { status: 'cancelled' };

function refused(
    code: MeasurementScopeRefusalCode,
    targetId: string | null = null
): Extract<RenderAgentMeasurementScopeResult, { status: 'refused' }> {
    return { status: 'refused', code, targetId, contributorId: null };
}

async function renderMixdown(
    input: RenderAgentMeasurementScopeInput,
    onWarning: (message: string) => void
): Promise<AudioBuffer> {
    // Distinguishes "this abort raised the flag" from "the flag was already
    // raised by something else" — the second must survive this render untouched.
    let raisedCancelFlag = false;
    const cancelActiveRender = () => {
        raisedCancelFlag = true;
        cancelExport();
    };
    input.signal?.addEventListener('abort', cancelActiveRender, { once: true });
    try {
        return await renderOffline({
            startBeat: input.startBeat,
            durationBeats: input.endBeat - input.startBeat,
            sampleRate: ANALYSIS_MEASURE_MIXDOWN_SAMPLE_RATE,
            tailSeconds: 0,
            onWarning,
        });
    } finally {
        input.signal?.removeEventListener('abort', cancelActiveRender);
        // `renderOffline`'s own render lock (acquired and released inside
        // `executeOfflineRender`) is already released by the time this render
        // has settled either way. Nothing else lowers the process-wide cancel
        // flag until the next mixdown or stem export begins its own scope
        // (`beginExportCancellationScope`) — without this, a run stopped mid
        // measurement leaves every later freeze or bounce reading a flag this
        // measurement raised and failing with "Export cancelled" (scheduleTrackClips's
        // `checkCancel`). Lower it here, before this render reports its outcome,
        // and only when this abort is the one that raised it.
        if (raisedCancelFlag) {
            resetCancelFlag();
        }
    }
}

async function renderTarget(
    target: MeasurementTarget,
    input: RenderAgentMeasurementScopeInput,
    onWarning: (message: string) => void
): Promise<TargetRenderOutcome> {
    try {
        if (target.subgraph === null) {
            return { status: 'buffer', buffer: await renderMixdown(input, onWarning) };
        }
        const buffer = await renderAgentMeasurementTarget({
            targetId: target.targetId,
            subgraph: target.subgraph,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            abortSignal: input.signal,
            onWarning,
        });
        return { status: 'buffer', buffer };
    } catch {
        return input.signal?.aborted ? { status: 'cancelled' } : { status: 'failed' };
    }
}

type MeasuredTargetOutcome =
    | { status: 'rendered'; target: RenderedMeasurementTarget }
    | Extract<RenderAgentMeasurementScopeResult, { status: 'refused' | 'cancelled' }>;

/** One target rendered between two live revision checks, or why it was not. */
async function renderMeasurementTarget(
    target: MeasurementTarget,
    input: RenderAgentMeasurementScopeInput,
    onWarning: (message: string) => void
): Promise<MeasuredTargetOutcome> {
    if (input.signal?.aborted) {
        return { status: 'cancelled' };
    }
    if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.sourceRevision)) {
        return refused('stale-revision', target.targetId);
    }
    const outcome = await renderTarget(target, input, onWarning);
    if (outcome.status === 'cancelled' || input.signal?.aborted) {
        return { status: 'cancelled' };
    }
    if (outcome.status === 'failed') {
        return refused('render-failed', target.targetId);
    }
    const { buffer } = outcome;
    if (buffer === null || buffer.length === 0 || buffer.numberOfChannels === 0) {
        return refused('empty-render', target.targetId);
    }
    const contentAddress = await getAudioBufferContentAddress(buffer);
    if (input.signal?.aborted) {
        return { status: 'cancelled' };
    }
    if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.sourceRevision)) {
        return refused('stale-revision', target.targetId);
    }
    return {
        status: 'rendered',
        target: {
            targetId: target.targetId,
            targetKind: target.targetKind,
            route: target.subgraph === null ? 'mixdown' : 'isolated-subgraph',
            liveAudibility: target.liveAudibility,
            buffer,
            artifact: {
                contentAddress,
                sampleRate: buffer.sampleRate,
                frameCount: buffer.length,
                channelCount: buffer.numberOfChannels,
                durationSeconds: buffer.duration,
            },
        },
    };
}

/**
 * Render every target of one agent measurement scope offline at the caller's
 * project revision, and retain each render as a content-addressed artifact.
 *
 * Targets are resolved and every refusal is decided before anything renders.
 * The live revision is compared before and after each render; a mismatch, an
 * abort, or a failed render retains nothing from the whole scope.
 */
export async function renderAgentMeasurementScope(
    input: RenderAgentMeasurementScopeInput
): Promise<RenderAgentMeasurementScopeResult> {
    if (input.signal?.aborted) {
        return { status: 'cancelled' };
    }
    const resolution = resolveAgentMeasurementTargets(input.scope);
    if (resolution.status === 'refused') {
        return resolution;
    }
    if (input.scope.kind === 'master' && isExportActive()) {
        return refused('render-busy');
    }
    const warnings: string[] = [];
    const onWarning = (message: string) => warnings.push(message);
    const rendered: RenderedMeasurementTarget[] = [];
    for (const target of resolution.targets) {
        const outcome = await renderMeasurementTarget(target, input, onWarning);
        if (outcome.status !== 'rendered') {
            return outcome;
        }
        rendered.push(outcome.target);
    }
    const oversized = retainAgentMeasurementArtifacts({
        renders: rendered.map((target) => ({ contentAddress: target.artifact.contentAddress, buffer: target.buffer })),
        sourceRevision: input.sourceRevision,
    });
    for (const contentAddress of oversized) {
        warnings.push(`Render ${contentAddress} exceeds the measurement retention limit and was not retained.`);
    }
    return { status: 'rendered', soloActive: resolution.soloActive, targets: rendered, warnings };
}
