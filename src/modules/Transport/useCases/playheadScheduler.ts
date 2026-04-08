import { transportStore } from '../stores/transportStore';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { getTempoAtBeat } from '../models/TempoMap';
import {
    trackStore,
    startRecording,
    stopRecording,
    addTakeLane,
    addTake,
    takeLaneStore,
} from '#/modules/Arrangement';
import { evaluateFollowActions } from './evaluateFollowActions';
import { startAutomationRecording, stopAutomationRecording } from '#/modules/Automation';
import {
    stopAllScheduled,
    audioBufferCache,
    startAudioRecording,
    stopAudioRecording,
    getAudioContext,
} from '#/modules/AudioEngine';
import { scheduleMetronome, resetMetronomeBeat } from './scheduling/scheduleMetronome';
import { scheduleMidiNotes } from './scheduling/scheduleMidiNotes';
import { scheduleAudioClips } from './scheduling/scheduleAudioClips';
import { applyVcaGains, applyAutomation } from './scheduling/applyAutomation';

let timerId: ReturnType<typeof setTimeout> | null = null;
let lastTickTime = 0;
let accumulatedPosition = 0;
let lastScheduledBeat = -1;
const scheduledAudioClips = new Set<string>();
const scheduledFrozenTracks = new Set<string>();
const activeAudioSources: AudioBufferSourceNode[] = [];
let punchRecordingActive = false;
let punchRecordingClipIds: string[] = [];

const SCHEDULE_AHEAD_SECONDS = 0.1;
const DEFAULT_SCHEDULE_GRAIN_MS = 10;

export function startPlayheadScheduler(): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    startAutomationRecording();

    const ctx = getAudioContext();
    lastTickTime = ctx.currentTime;
    accumulatedPosition = state.playheadPosition;
    playheadPositionRef.current = state.playheadPosition;
    lastScheduledBeat = state.playheadPosition - 0.0001;
    resetMetronomeBeat(state.playheadPosition);

    const grainMs = state.scheduleGrainMs ?? DEFAULT_SCHEDULE_GRAIN_MS;

    const tick = async (): Promise<void> => {
        const current = transportStore.value;
        if (!current?.isPlaying) {
            return;
        }

        const now = ctx.currentTime;
        const deltaSec = now - lastTickTime;
        lastTickTime = now;

        const changes = tempoMapStore.value?.changes ?? [];
        const currentTempo = getTempoAtBeat(changes, accumulatedPosition, current.tempo);
        const beatsPerSecond = currentTempo / 60;
        const deltaBeats = deltaSec * beatsPerSecond;
        let newPosition = accumulatedPosition + deltaBeats;

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
            lastScheduledBeat = newPosition - 0.0001;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            const now = ctx.currentTime;
            for (const src of activeAudioSources as any[]) {
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
            activeAudioSources.length = 0;
            scheduledAudioClips.clear();
            scheduledFrozenTracks.clear();
        }

        const tracks = trackStore.value?.tracks ?? [];
        const { jumpToPosition: rawJumpToPosition, shouldStop } = evaluateFollowActions(
            tracks,
            accumulatedPosition,
            newPosition
        );
        let jumpToPosition = rawJumpToPosition;

        if (shouldStop) {
            import('./transportControls/stopPlayback').then(({ stopPlayback }) => stopPlayback());
            return;
        }

        if (jumpToPosition !== null) {
            newPosition = jumpToPosition;
            lastScheduledBeat = newPosition;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            const now = ctx.currentTime;
            for (const src of activeAudioSources as any[]) {
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
            activeAudioSources.length = 0;
            scheduledAudioClips.clear();
            scheduledFrozenTracks.clear();
        }

        accumulatedPosition = newPosition;
        playheadPositionRef.current = newPosition;

        const hasArmedTracks = trackStore.value?.tracks.some((t) => t.armed) ?? false;
        if (
            current.punchInEnabled &&
            !current.isRecording &&
            !punchRecordingActive &&
            hasArmedTracks &&
            current.punchInBeat < current.punchOutBeat &&
            newPosition >= current.punchInBeat
        ) {
            punchRecordingActive = true;
            const clips = startRecording();
            punchRecordingClipIds = clips.map((c) => c.id);
            transportStore.set({ ...transportStore.value!, isRecording: true });

            const armedTracks = trackStore.value?.tracks.filter((t) => t.armed) ?? [];
            for (const track of armedTracks) {
                if (track.kind === 'audio') {
                    const recClip = clips.find((c) => c.trackId === track.id);
                    startAudioRecording(track.id, (buffer) => {
                        const bufferId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

        if (punchRecordingActive && current.punchInEnabled && newPosition >= current.punchOutBeat) {
            stopAudioRecording();
            stopRecording(punchRecordingClipIds);
            punchRecordingClipIds = [];
            punchRecordingActive = false;
            transportStore.set({ ...transportStore.value!, isRecording: false });
        }

        const lookAheadBeats = SCHEDULE_AHEAD_SECONDS * beatsPerSecond;
        const scheduleUpTo = newPosition + lookAheadBeats;

        scheduleMetronome(lastScheduledBeat, scheduleUpTo, accumulatedPosition, current, currentTempo);
        await scheduleMidiNotes(
            lastScheduledBeat,
            scheduleUpTo,
            accumulatedPosition,
            lastScheduledBeat,
            activeAudioSources,
            current,
            currentTempo
        );
        scheduleAudioClips(
            lastScheduledBeat,
            scheduleUpTo,
            accumulatedPosition,
            scheduledAudioClips,
            scheduledFrozenTracks,
            activeAudioSources,
            current,
            currentTempo
        );
        applyVcaGains();
        applyAutomation(newPosition);

        lastScheduledBeat = scheduleUpTo;

        timerId = setTimeout(tick, current.scheduleGrainMs ?? grainMs);
    };

    timerId = setTimeout(tick, grainMs);
}

export function stopPlayheadScheduler(): void {
    stopAutomationRecording();
    if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
    }
    if (punchRecordingActive) {
        stopAudioRecording();
        stopRecording(punchRecordingClipIds);
        punchRecordingClipIds = [];
        punchRecordingActive = false;
    }
    lastTickTime = 0;
    accumulatedPosition = 0;
    lastScheduledBeat = -1;
    resetMetronomeBeat(0);
    scheduledAudioClips.clear();
    scheduledFrozenTracks.clear();
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    for (const src of activeAudioSources as any[]) {
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
    activeAudioSources.length = 0;
    stopAllScheduled();
}
