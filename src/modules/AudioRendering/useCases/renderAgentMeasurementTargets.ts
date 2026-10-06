import { renderAgentMeasurementTarget, type resolveAgentMeasurementTargets } from '#/modules/Arrangement/useCases';
import {
    cancelExport,
    captureOfflineRenderInput,
    renderOffline,
    renderOfflineInput,
    resetCancelFlag,
    type captureOfflineRenderProjectSource,
} from '#/modules/AudioEngine/useCases';
import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

/**
 * The master mixdown renders at this rate; an isolated track or bus renders at
 * the live context's rate. Every measured metric is defined in physical units
 * (LUFS, dBTP, Hz, ratios), so figures stay comparable across routes whose
 * render rates differ.
 */
const ANALYSIS_MEASURE_MIXDOWN_SAMPLE_RATE = 48_000;

type ResolvedTargets = Extract<ReturnType<typeof resolveAgentMeasurementTargets>, { status: 'resolved' }>;
type MeasurementTarget = ResolvedTargets['targets'][number];
type ProjectSource = ReturnType<typeof captureOfflineRenderProjectSource>;

type RenderAgentMeasurementTargetsInput = {
    targets: readonly MeasurementTarget[];
    startBeat: number;
    endBeat: number;
    /** The revision every render must still find the live project at, before it starts and after it ends. */
    sourceRevision: string;
    signal?: AbortSignal;
    /** The document the targets were resolved from; absent, the live project renders. */
    project?: ProjectSource;
    onWarning: (message: string) => void;
    /** Called as each target's render begins, so a caller counts the renders that actually ran. */
    onRenderStart?: () => void;
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

type TargetRefusal = {
    status: 'refused';
    code: 'stale-revision' | 'empty-render' | 'render-failed';
    targetId: string;
    contributorId: null;
};

type TargetRenderOutcome =
    { status: 'buffer'; buffer: AudioBuffer | null } | { status: 'failed' } | { status: 'cancelled' };

type MeasuredTargetOutcome =
    { status: 'rendered'; target: RenderedMeasurementTarget } | TargetRefusal | { status: 'cancelled' };

function refused(code: TargetRefusal['code'], targetId: string): TargetRefusal {
    return { status: 'refused', code, targetId, contributorId: null };
}

/** A supplied document is captured whole before the shared renderer can yield; the live project renders as it always has. */
function renderMixdownBuffer(
    options: Parameters<typeof captureOfflineRenderInput>[0],
    project: ProjectSource | undefined
): Promise<AudioBuffer> {
    if (project === undefined) {
        return renderOffline(options);
    }
    return renderOfflineInput(captureOfflineRenderInput(options, { project }), options);
}

async function renderMixdown(input: RenderAgentMeasurementTargetsInput): Promise<AudioBuffer> {
    // Distinguishes "this abort raised the flag" from "the flag was already
    // raised by something else" — the second must survive this render untouched.
    let raisedCancelFlag = false;
    const cancelActiveRender = () => {
        raisedCancelFlag = true;
        cancelExport();
    };
    input.signal?.addEventListener('abort', cancelActiveRender, { once: true });
    try {
        return await renderMixdownBuffer(
            {
                startBeat: input.startBeat,
                durationBeats: input.endBeat - input.startBeat,
                sampleRate: ANALYSIS_MEASURE_MIXDOWN_SAMPLE_RATE,
                tailSeconds: 0,
                onWarning: input.onWarning,
            },
            input.project
        );
    } finally {
        input.signal?.removeEventListener('abort', cancelActiveRender);
        // The shared render lock (acquired and released inside
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
    input: RenderAgentMeasurementTargetsInput
): Promise<TargetRenderOutcome> {
    try {
        if (target.subgraph === null) {
            return { status: 'buffer', buffer: await renderMixdown(input) };
        }
        const buffer = await renderAgentMeasurementTarget({
            targetId: target.targetId,
            subgraph: target.subgraph,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            abortSignal: input.signal,
            onWarning: input.onWarning,
            source: input.project === undefined ? undefined : { project: input.project },
        });
        return { status: 'buffer', buffer };
    } catch {
        return input.signal?.aborted ? { status: 'cancelled' } : { status: 'failed' };
    }
}

/** One target rendered between two live revision checks, or why it was not. */
async function renderMeasurementTarget(
    target: MeasurementTarget,
    input: RenderAgentMeasurementTargetsInput
): Promise<MeasuredTargetOutcome> {
    if (input.signal?.aborted) {
        return { status: 'cancelled' };
    }
    if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.sourceRevision)) {
        return refused('stale-revision', target.targetId);
    }
    input.onRenderStart?.();
    const outcome = await renderTarget(target, input);
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
 * Render resolved measurement targets one after another, each between two
 * live revision checks, stopping at the first that does not render.
 *
 * The live revision binds a supplied document too: it is the revision the
 * document was taken from, and once the live project leaves it the document no
 * longer describes a change to the project in front of the caller.
 */
export async function renderAgentMeasurementTargets(
    input: RenderAgentMeasurementTargetsInput
): Promise<{ status: 'rendered'; targets: RenderedMeasurementTarget[] } | TargetRefusal | { status: 'cancelled' }> {
    const rendered: RenderedMeasurementTarget[] = [];
    for (const target of input.targets) {
        const outcome = await renderMeasurementTarget(target, input);
        if (outcome.status !== 'rendered') {
            return outcome;
        }
        rendered.push(outcome.target);
    }
    return { status: 'rendered', targets: rendered };
}
