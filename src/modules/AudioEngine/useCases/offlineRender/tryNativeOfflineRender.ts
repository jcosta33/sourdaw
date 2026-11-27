import { adjustmentLayerStore } from '#/modules/Arrangement/stores';
import { modulationStore } from '#/modules/Automation/stores';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { nativeEngineHostedStripIds } from './nativeEngineHostedStripIds';
import { nativeProgrammeHeadFrames } from './nativeProgrammeHeadFrames';
import { readNativeOfflineHostedRuntime } from './readNativeOfflineHostedRuntime';
import { renderOfflineWithNativeEngine } from './renderOfflineWithNativeEngine';
import { type resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { selectOfflineRenderEngine } from './selectOfflineRenderEngine';
import { type OfflineRenderOptions } from './types';

/**
 * What the native engine printed, and how many frames of its programme's own
 * compensation sit ahead of the requested window. The engine has already
 * dropped the depth it holds the master to.
 */
export type NativeOfflineRender = { buffer: AudioBuffer; compensationHeadFrameCount: number };

/**
 * The native render's own printed head. Its programme delays the master by less than
 * the Web Audio render does, because the engine holds part of the session
 * depth itself and trims that part on its side, so a printed head here is
 * the programme's share alone.
 */
function resolveNativeHeadFrames(
    input: ReturnType<typeof captureOfflineRenderInput>,
    plan: ReturnType<typeof resolveOfflineMixPlan>
) {
    if (!plan.printsCompensationHead) {
        return 0;
    }
    const hostedStripIds = nativeEngineHostedStripIds(plan.allRenderableTracks);
    return nativeProgrammeHeadFrames(input.scheduling.latency, hostedStripIds, input.sampleRate);
}

function resolveNativeSpan(
    input: ReturnType<typeof captureOfflineRenderInput>,
    plan: ReturnType<typeof resolveOfflineMixPlan>
) {
    const { sampleRate } = input;
    const compensationHeadFrameCount = resolveNativeHeadFrames(input, plan);
    const frameCount = plan.frameCount - plan.compensationHeadFrameCount + compensationHeadFrameCount;
    const durationSeconds =
        frameCount === plan.frameCount ? plan.renderContext.durationSeconds : frameCount / sampleRate;
    return { frameCount, durationSeconds, compensationHeadFrameCount };
}

export async function tryNativeOfflineRender(
    input: ReturnType<typeof captureOfflineRenderInput>,
    plan: ReturnType<typeof resolveOfflineMixPlan>,
    { onWarning, onProgress, abortSignal }: Pick<OfflineRenderOptions, 'onWarning' | 'onProgress' | 'abortSignal'>
): Promise<NativeOfflineRender | null> {
    const { sampleRate } = input;
    const {
        masterGainValue,
        allRenderableTracks,
        scheduledTracks,
        contributingTrackIds,
        soloGatedByTrackId,
        vcaMultiplierByTrackId,
        renderContext,
    } = plan;
    const { defaultTempo, changes, projectPpqEndpoints, resolveTempoAtBeat, tracks } = renderContext;
    const { frameCount, durationSeconds, compensationHeadFrameCount } = resolveNativeSpan(input, plan);
    // The D3.c.2 cutover (#2225): a desktop export the native engine can
    // hold renders through it; every other outcome carries its reason, and
    // a *degraded* one — a native engine that exists here and was passed
    // over — is surfaced on the export's warning channel. A native attempt
    // that declines mid-flight falls back the same observable way; a
    // cancellation or a seam defect propagates instead of falling back.
    // One reading of the loaded hosted instances for both halves, taken from
    // the capture, so the selection and the programme admit the same devices.
    const hostedPluginRuntime = readNativeOfflineHostedRuntime(input.loadedExternalInstanceIds);
    const selection = await selectOfflineRenderEngine({
        // The exact count the native render requests below, so an export past
        // its ceiling stays on Web Audio instead of failing there.
        frameCount,
        renderableTracks: allRenderableTracks,
        scheduledTracks,
        gainEnvelopes: input.scheduling.gainEnvelopes,
        // The routes this render's own latency and detector wiring read.
        sidechainRoutes: input.scheduling.latency.routes,
        // The rack and stack the Web Audio render carries and the native one
        // has no vocabulary for. Read live, as the scheduling input's own
        // store fallbacks are: a document-source render reads the live rack
        // and stack the same way it already reads the automation lanes.
        modulators: modulationStore.value?.modulators ?? [],
        adjustmentLayers: adjustmentLayerStore.value?.layers ?? [],
        // An implicit layer position resolves against the full project track
        // list, exactly as live's `resolveAffectedTrackIds` and the Web Audio
        // composition do — not against the renderable subset, whose index
        // space a folder or disabled track ahead of the stack shifts.
        projectTrackIds: (tracks?.tracks ?? allRenderableTracks).map((track) => track.id),
        hostedPluginRuntime,
    });
    if (selection.engine === 'native/offline') {
        const native = await renderOfflineWithNativeEngine({
            transport: selection.transport,
            captured: input,
            sampleRate,
            frameCount,
            durationSeconds,
            masterGainValue,
            defaultTempo,
            changes,
            projectPpqEndpoints,
            resolveTempoAtBeat,
            renderableTracks: allRenderableTracks,
            scheduledTracks,
            contributingTrackIds,
            soloGatedByTrackId,
            vcaMultiplierByTrackId,
            onWarning,
            onProgress,
            abortSignal,
            hostedPluginRuntime,
            printsCompensationHead: plan.printsCompensationHead,
        });
        if (native.outcome === 'rendered') {
            return { buffer: native.buffer, compensationHeadFrameCount };
        }
        onWarning?.(`The native engine declined this export (${native.reason}); rendering through Web Audio.`);
    } else if (selection.degraded) {
        onWarning?.(`Desktop export fell back to the Web Audio renderer: ${selection.reason}`);
    }

    return null;
}
