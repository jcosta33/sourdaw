import { transportStore } from '../stores/transportStore';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { getTempoAtBeat } from '../models/TempoMap';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { startAutomationRecording } from '#/modules/Automation/useCases/automationRecording/startAutomationRecording';
import { stopAutomationRecording } from '#/modules/Automation/useCases/automationRecording/stopAutomationRecording';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { startAudioRecording, stopAudioRecording } from '#/modules/AudioEngine/useCases/audioRecorder';
import { startRecording, stopRecording } from '#/modules/Arrangement/useCases/recording';
import { addTakeLane } from '#/modules/Arrangement/useCases/comping/addTakeLane';
import { addTake } from '#/modules/Arrangement/useCases/comping/addTake';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
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

    function tick(): void {
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
            for (const src of activeAudioSources) {
                try {
                    src.stop();
                } catch {
                    /* already stopped */
                }
            }
            activeAudioSources.length = 0;
            scheduledAudioClips.clear();
            scheduledFrozenTracks.clear();
        }

        let jumpToPosition: number | null = null;
        let shouldStop = false;

        const tracks = trackStore.value?.tracks ?? [];
        for (const track of tracks) {
            for (const clip of track.clips) {
                if (
                    clip.followAction &&
                    !clip.loopEnabled &&
                    accumulatedPosition < clip.endBeat &&
                    newPosition >= clip.endBeat
                ) {
                    if (clip.followAction === 'stop') {
                        shouldStop = true;
                    } else if (clip.followAction === 'play_next') {
                        const nextClips = track.clips.filter((c) => c.startBeat >= clip.endBeat && c.id !== clip.id);
                        nextClips.sort((a, b) => a.startBeat - b.startBeat);
                        if (nextClips[0]) {
                            jumpToPosition = nextClips[0].startBeat;
                        }
                    } else if (clip.followAction === 'play_previous') {
                        const prevClips = track.clips.filter((c) => c.endBeat <= clip.startBeat && c.id !== clip.id);
                        prevClips.sort((a, b) => a.startBeat - b.startBeat);
                        if (prevClips[prevClips.length - 1]) {
                            jumpToPosition = prevClips[prevClips.length - 1]!.startBeat;
                        }
                    } else if (clip.followAction === 'play_first') {
                        const firstClip = [...track.clips].sort((a, b) => a.startBeat - b.startBeat)[0];
                        if (firstClip) {
                            jumpToPosition = firstClip.startBeat;
                        }
                    } else if (clip.followAction === 'play_last') {
                        const lastClip = [...track.clips].sort((a, b) => b.startBeat - a.startBeat)[0];
                        if (lastClip) {
                            jumpToPosition = lastClip.startBeat;
                        }
                    } else if (clip.followAction === 'play_random') {
                        const otherClips = track.clips.filter((c) => c.id !== clip.id);
                        if (otherClips.length > 0) {
                            const randomClip = otherClips[Math.floor(Math.random() * otherClips.length)];
                            if (randomClip) {
                                jumpToPosition = randomClip.startBeat;
                            }
                        }
                    }
                }
            }
        }

        if (shouldStop) {
            import('./transportControls').then(({ stopPlayback }) => stopPlayback());
            return;
        }

        if (jumpToPosition !== null) {
            newPosition = jumpToPosition;
            lastScheduledBeat = newPosition;
            resetMetronomeBeat(newPosition);
            stopAllScheduled();
            for (const src of activeAudioSources) {
                try {
                    src.stop();
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
                    void startAudioRecording(track.id, (buffer) => {
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
        scheduleMidiNotes(lastScheduledBeat, scheduleUpTo, accumulatedPosition, lastScheduledBeat, activeAudioSources, current, currentTempo);
        scheduleAudioClips(lastScheduledBeat, scheduleUpTo, accumulatedPosition, scheduledAudioClips, scheduledFrozenTracks, activeAudioSources, current, currentTempo);
        applyVcaGains();
        applyAutomation(newPosition);

        lastScheduledBeat = scheduleUpTo;

        timerId = setTimeout(tick, current.scheduleGrainMs ?? grainMs);
    }

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
    for (const src of activeAudioSources) {
        try {
            src.stop();
        } catch {
            /* already stopped */
        }
    }
    activeAudioSources.length = 0;
    stopAllScheduled();
}
