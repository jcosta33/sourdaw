import { transportStore } from '../stores/transportStore';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { getTempoAtBeat } from '../models/TempoMap';
import { startRecording, stopRecording, addTakeLane, addTake } from '#/modules/Arrangement/useCases';
import { trackStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { evaluateFollowActions } from './evaluateFollowActions';
import { startAutomationRecording, stopAutomationRecording } from '#/modules/Automation';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    stopAllScheduled,
    startAudioRecording,
    stopAudioRecording,
    getAudioContext,
} from '#/modules/AudioEngine/useCases';
import { scheduleMetronome, resetMetronomeBeat } from './scheduling/scheduleMetronome';
import { scheduleMidiNotes } from './scheduling/scheduleMidiNotes';
import { scheduleAudioClips } from './scheduling/scheduleAudioClips';
import { applyVcaGains } from './scheduling/applyAutomation/applyVcaGains';
import { applyAutomation } from './scheduling/applyAutomation/applyAutomation';

export type SourceWithFade = AudioBufferSourceNode & { fadeGainNode?: GainNode };

function stopActiveSources(sources: AudioBufferSourceNode[], ctx: BaseAudioContext): void {
    const now = ctx.currentTime;
    for (const src of sources as SourceWithFade[]) {
        try {
            if (src.fadeGainNode) {
                src.fadeGainNode.gain.cancelScheduledValues(now);
                src.fadeGainNode.gain.setValueAtTime(src.fadeGainNode.gain.value, now);
                src.fadeGainNode.gain.linearRampToValueAtTime(0, now + 0.005);
                src.stop(now + 0.005);
            } else {
                src.stop(now + 0.005);
            }
        } catch {
            /* already stopped */
        }
    }
    sources.length = 0;
}

// §28.1 / §107.1 — Coalesce scheduler mutables into a single holder so
// the active playback session lives behind one handle. Mutation is still
// only done from within this file; the holder object prevents importers
// from rebinding any of these via \`export let\`.
const schedulerSession = {
    timerId: null as ReturnType<typeof setTimeout> | null,
    lastTickTime: 0,
    accumulatedPosition: 0,
    lastScheduledBeat: -1,
    scheduledAudioClips: new Set<string>(),
    scheduledFrozenTracks: new Set<string>(),
    activeAudioSources: [] as AudioBufferSourceNode[],
    punchRecordingActive: false,
};

const SCHEDULE_AHEAD_SECONDS = 0.1;
const DEFAULT_SCHEDULE_GRAIN_MS = 10;

export function startPlayheadScheduler(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    startAutomationRecording();

    const ctx = getAudioContext();
    schedulerSession.lastTickTime = ctx.currentTime;
    schedulerSession.accumulatedPosition = state.playheadPosition;
    playheadPositionRef.current = state.playheadPosition;
    schedulerSession.lastScheduledBeat = state.playheadPosition - 0.0001;
    resetMetronomeBeat(state.playheadPosition);

    const grainMs = state.scheduleGrainMs ?? DEFAULT_SCHEDULE_GRAIN_MS;

    const tick = async (): Promise<void> => {
        const current = transportStore.value;
        if (!current?.isPlaying) {
            return;
        }

        const now = ctx.currentTime;
        const deltaSec = now - schedulerSession.lastTickTime;
        schedulerSession.lastTickTime = now;

        const changes = tempoMapStore.value?.changes ?? [];
        const currentTempo = getTempoAtBeat(changes, schedulerSession.accumulatedPosition, current.tempo);
        const beatsPerSecond = currentTempo / 60;
        const deltaBeats = deltaSec * beatsPerSecond;
        let newPosition = schedulerSession.accumulatedPosition + deltaBeats;

        if (current.isLooping && current.loopEnd > current.loopStart && newPosition >= current.loopEnd) {
            if (current.isRecording) {
                const armedTracks = trackStore.value?.tracks.filter((t) => t.armed) ?? [];
                for (const track of armedTracks) {
                    const laneState = takeLaneStore.value;
                    if (!laneState?.lanes.some((l) => l.trackId === track.id)) {
                        addTakeLane(track.id);
                    }
                    const takeNum =
                        (takeLaneStore.value?.lanes.find((l) => l.trackId === track.id)?.takes.length ?? 0) + 1;
                    addTake(
                        track.id,
                        `take-${Date.now()}-${track.id}`,
                        `Take ${takeNum}`,
                        current.loopStart,
                        current.loopEnd
                    );
                }
            }

            const loopLength = current.loopEnd - current.loopStart;
            newPosition = current.loopStart + ((newPosition - current.loopStart) % loopLength);
            schedulerSession.lastScheduledBeat = newPosition - 0.0001;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            stopActiveSources(schedulerSession.activeAudioSources, ctx);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
        }

        const tracks = trackStore.value?.tracks ?? [];
        const { jumpToPosition: rawJumpToPosition, shouldStop } = evaluateFollowActions(
            tracks,
            schedulerSession.accumulatedPosition,
            newPosition
        );
        let jumpToPosition = rawJumpToPosition;

        if (shouldStop) {
            import('./transportControls/stopPlayback').then(({ stopPlayback }) => stopPlayback());
            return;
        }

        if (jumpToPosition !== null) {
            newPosition = jumpToPosition;
            schedulerSession.lastScheduledBeat = newPosition;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            stopActiveSources(schedulerSession.activeAudioSources, ctx);
            schedulerSession.scheduledAudioClips.clear();
            schedulerSession.scheduledFrozenTracks.clear();
        }

        schedulerSession.accumulatedPosition = newPosition;
        playheadPositionRef.current = newPosition;

        const hasArmedTracks = trackStore.value?.tracks.some((t) => t.armed) ?? false;
        if (
            current.punchInEnabled &&
            !current.isRecording &&
            !schedulerSession.punchRecordingActive &&
            hasArmedTracks &&
            current.punchInBeat < current.punchOutBeat &&
            newPosition >= current.punchInBeat
        ) {
            schedulerSession.punchRecordingActive = true;
            const clips = startRecording();
            transportStore.set({ ...transportStore.value!, isRecording: true });

            const armedTracks = trackStore.value?.tracks.filter((t) => t.armed) ?? [];
            for (const track of armedTracks) {
                if (track.kind === 'audio') {
                    const recClip = clips.find((c) => c.trackId === track.id);
                    startAudioRecording(track.id, (buffer) => {
                        const bufferId = `rec-${crypto.randomUUID()}`;
                        audioBufferCache.set(bufferId, buffer);
                        if (recClip) {
                            const ts = trackStore.value;
                            if (ts) {
                                trackStore.set({
                                    ...ts,
                                    tracks: ts.tracks.map((t) => ({
                                        ...t,
                                        clips: t.clips.map((c) =>
                                            c.id === recClip.id ? { ...c, audioBufferId: bufferId } : c
                                        ),
                                    })),
                                });
                            }
                        }
                    });
                }
            }
        }

        if (schedulerSession.punchRecordingActive && current.punchInEnabled && newPosition >= current.punchOutBeat) {
            stopAudioRecording();
            stopRecording();
            schedulerSession.punchRecordingActive = false;
            transportStore.set({ ...transportStore.value!, isRecording: false });
        }

        const lookAheadBeats = SCHEDULE_AHEAD_SECONDS * beatsPerSecond;
        const scheduleUpTo = newPosition + lookAheadBeats;

        scheduleMetronome(schedulerSession.lastScheduledBeat, scheduleUpTo, schedulerSession.accumulatedPosition, current, currentTempo);
        await scheduleMidiNotes(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            schedulerSession.lastScheduledBeat,
            schedulerSession.activeAudioSources,
            current,
            currentTempo
        );
        scheduleAudioClips(
            schedulerSession.lastScheduledBeat,
            scheduleUpTo,
            schedulerSession.accumulatedPosition,
            schedulerSession.scheduledAudioClips,
            schedulerSession.scheduledFrozenTracks,
            schedulerSession.activeAudioSources,
            current,
            currentTempo
        );
        applyVcaGains();
        applyAutomation(newPosition);

        schedulerSession.lastScheduledBeat = scheduleUpTo;

        schedulerSession.timerId = setTimeout(tick, current.scheduleGrainMs ?? grainMs);
    };

    schedulerSession.timerId = setTimeout(tick, grainMs);
}

export function stopPlayheadScheduler(): void {
    stopAutomationRecording();
    if (schedulerSession.timerId !== null) {
        clearTimeout(schedulerSession.timerId);
        schedulerSession.timerId = null;
    }
    if (schedulerSession.punchRecordingActive) {
        stopAudioRecording();
        stopRecording();
        schedulerSession.punchRecordingActive = false;
    }
    schedulerSession.lastTickTime = 0;
    schedulerSession.accumulatedPosition = 0;
    schedulerSession.lastScheduledBeat = -1;
    resetMetronomeBeat(0);
    schedulerSession.scheduledAudioClips.clear();
    schedulerSession.scheduledFrozenTracks.clear();
    const ctx = getAudioContext();
    stopActiveSources(schedulerSession.activeAudioSources, ctx);
    stopAllScheduled();
}
