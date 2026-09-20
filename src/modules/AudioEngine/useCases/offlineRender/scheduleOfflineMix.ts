import { type ScheduleCall } from '../../repositories/offlineScheduler/makeOfflineFrameScheduler';

import { type buildOfflineWebAudioGraph } from './buildOfflineWebAudioGraph';
import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { checkCancel } from './checkCancel';
import { collectDeviceRuntimeFailures } from './collectDeviceRuntimeFailures';
import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER } from './constants';
import { renderInSegments } from './renderInSegments';
import { type resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { schedulePendingSuspends } from './schedulePendingSuspends';
import { scheduleTrackClips } from './scheduleTrackClips';
import { type OfflineRenderOptions, type PendingWorkletEvent } from './types';
import { yieldToMain } from './yieldToMain';

type ScheduleInput = {
    input: ReturnType<typeof captureOfflineRenderInput>;
    plan: ReturnType<typeof resolveOfflineMixPlan>;
    graph: Awaited<ReturnType<typeof buildOfflineWebAudioGraph>>;
    offlineCtx: OfflineAudioContext;
    masterGain: GainNode;
    scheduleFrame: ScheduleCall;
    callbacks: Pick<OfflineRenderOptions, 'onProgress' | 'onWarning'>;
};

function renderScheduledMix({ plan, graph, offlineCtx, callbacks }: ScheduleInput): Promise<AudioBuffer> {
    const {
        sourceTracks,
        renderContext: { durationSeconds },
    } = plan;
    const { deviceEntriesByTrack } = graph;
    const { onProgress } = callbacks;
    // Render in suspendable segments. Each boundary is both a
    // real abort point (a cancelled render is left suspended rather than
    // running to completion in the background) and the only truthful
    // progress signal the API offers, replacing the old eased timer that
    // animated toward 97% regardless of what the renderer was doing.
    // Scheduling owns 0-50%, so the render phase maps onto the back half.
    const schedulingFrac = sourceTracks.length > 0 ? 0.5 : 0;
    const renderTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
    let onRenderProgress: ((fraction: number) => void) | undefined;
    if (onProgress) {
        onRenderProgress = (fraction) => onProgress(schedulingFrac + fraction * (1 - schedulingFrac));
    }
    return renderInSegments({
        offlineCtx,
        durationSeconds,
        timeoutMs: renderTimeoutMs,
        ...collectDeviceRuntimeFailures(deviceEntriesByTrack),
        onRenderProgress,
    });
}

export async function scheduleOfflineMix(args: ScheduleInput): Promise<AudioBuffer> {
    const { input, plan, graph, offlineCtx, masterGain, scheduleFrame, callbacks } = args;
    const { onWarning, onProgress } = callbacks;
    const { scheduledTracks, sourceTracks, vcaMultiplierByTrackId, renderContext } = plan;
    const {
        tracks,
        midi,
        durationSeconds,
        defaultTempo,
        changes,
        projectMidiEvents,
        projectPpqEndpoints,
        resolveTempoAtBeat,
        processYeastMidi,
        selectMidiEventProbability,
        projectChordPitch,
        evaluateAutomationValue,
        resolveArticulationId,
    } = renderContext;
    const { trackStripsById, sendAutomationParamsByTrack, deviceEntriesByTrack } = graph;
    const pendingWorkletEvents: PendingWorkletEvent[] = [];
    let scheduled = 0;
    // Schedule the tracks that can still reach the mix — audible ones plus the
    // cue-send-only ones above — while keeping the full routing graph alive so
    // buses, targets, and the master strip behave like live playback.
    for (const track of scheduledTracks) {
        checkCancel();

        const strip = trackStripsById.get(track.id);
        if (!strip) {
            continue;
        }

        await scheduleTrackClips({
            captured: input.scheduling,
            offlineCtx,
            track,
            midi: midi!,
            trackInputNode: strip.inputNode,
            trackGainNode: strip.faderNode,
            trackPanNode: strip.panNode,
            sendAutomationParams: sendAutomationParamsByTrack.get(track.id),
            destination: masterGain,
            durationSeconds,
            defaultTempo,
            changes,
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                resolveTempoAtBeat,
                processYeastMidi,
                selectMidiEventProbability,
                projectChordPitch,
                evaluateAutomationValue,
                resolveArticulationId,
            },
            onWarning,
            pendingWorkletEvents,
            // Keep canonical project order for Toaster pad indexes. The
            // scheduler skips inaudible children only after indexing.
            allTracks: tracks?.tracks ?? [],
            deviceEntriesByTrack,
            regionStartBeat: 0,
            scheduleFrame,
            // Same multiplier the strip was seeded with, so a gain lane on a
            // VCA-member track rides its group instead of nullifying it.
            vcaMultiplier: vcaMultiplierByTrackId.get(track.id) ?? 1,
        });

        scheduled++;
        onProgress?.((scheduled / Math.max(1, sourceTracks.length)) * 0.5); // scheduling = 0-50%
    }

    // Register all worklet note suspend points ONCE after all tracks are scheduled.
    // This prevents duplicate suspend() calls when multiple tracks target the same frame.
    schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

    checkCancel();

    // Yield so the UI can paint the scheduling-complete mark before startRendering() blocks.
    await yieldToMain();

    return renderScheduledMix(args);
}
