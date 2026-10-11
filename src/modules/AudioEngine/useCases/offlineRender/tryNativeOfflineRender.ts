import { adjustmentLayerStore } from '#/modules/Arrangement/stores';
import { modulationStore } from '#/modules/Automation/stores';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { renderOfflineWithNativeEngine } from './renderOfflineWithNativeEngine';
import { type resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { selectOfflineRenderEngine } from './selectOfflineRenderEngine';
import { type OfflineRenderOptions } from './types';

export async function tryNativeOfflineRender(
    input: ReturnType<typeof captureOfflineRenderInput>,
    plan: ReturnType<typeof resolveOfflineMixPlan>,
    { onWarning, onProgress, abortSignal }: Pick<OfflineRenderOptions, 'onWarning' | 'onProgress' | 'abortSignal'>
): Promise<AudioBuffer | null> {
    const { sampleRate } = input;
    const {
        frameCount,
        masterGainValue,
        allRenderableTracks,
        scheduledTracks,
        contributingTrackIds,
        soloGatedByTrackId,
        vcaMultiplierByTrackId,
        renderContext,
    } = plan;
    const { durationSeconds, defaultTempo, changes, projectPpqEndpoints, resolveTempoAtBeat, tracks } = renderContext;
    // The D3.c.2 cutover (#2225): a desktop export the native engine can
    // hold renders through it; every other outcome carries its reason, and
    // a *degraded* one — a native engine that exists here and was passed
    // over — is surfaced on the export's warning channel. A native attempt
    // that declines mid-flight falls back the same observable way; a
    // cancellation or a seam defect propagates instead of falling back.
    const selection = await selectOfflineRenderEngine({
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
        });
        if (native.outcome === 'rendered') {
            return native.buffer;
        }
        onWarning?.(`The native engine declined this export (${native.reason}); rendering through Web Audio.`);
    } else if (selection.degraded) {
        onWarning?.(`Desktop export fell back to the Web Audio renderer: ${selection.reason}`);
    }

    return null;
}
