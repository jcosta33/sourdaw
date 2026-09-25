import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { renderOfflineWithNativeEngine } from './renderOfflineWithNativeEngine';
import { type resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { selectOfflineRenderEngine } from './selectOfflineRenderEngine';
import { type OfflineRenderOptions } from './types';

export async function tryNativeOfflineRender(
    input: ReturnType<typeof captureOfflineRenderInput>,
    plan: ReturnType<typeof resolveOfflineMixPlan>,
    { onWarning, onProgress }: Pick<OfflineRenderOptions, 'onWarning' | 'onProgress'>
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
    const { durationSeconds, defaultTempo, changes, projectPpqEndpoints, resolveTempoAtBeat } = renderContext;
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
