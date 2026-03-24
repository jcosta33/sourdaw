import { transportStore } from '../stores/transportStore';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { getTempoAtBeat } from '../models/TempoMap';
import { getTimeSignatureAtBeat } from '../models/TimeSignatureMap';
import { timeSignatureMapStore } from '../stores/timeSignatureMapStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases/automationUseCases';
import {
    startAutomationRecording,
    stopAutomationRecording,
    isRecordingAutomation,
} from '#/modules/Automation/useCases/automationRecording';
import { getEffectiveGain } from '#/modules/Arrangement/useCases/vcaUseCases';
import {
    ensureTrackStrip,
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import {
    scheduleClick,
    stopAllScheduled,
    getCurrentTime,
    createBufferSource,
} from '#/modules/AudioEngine/useCases/scheduling';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases/resolveComping';
import { scheduleNote, getSynthParamsForTrack } from '#/modules/Synth/useCases/builtinSynth';
import { getDrumKitByIndex, scheduleKitNote, type DrumKit } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote, type DrumKitDef } from '#/modules/Synth/useCases/drumSynthEngine';
import { getCompensationDelay } from '#/modules/AudioEngine/useCases/latencyCompensation';
import { startAudioRecording, stopAudioRecording } from '#/modules/AudioEngine/useCases/audioRecorder';
import { startRecording, stopRecording } from '#/modules/Arrangement/useCases/recordingUseCases';
import { addTakeLane, addTake } from '#/modules/Arrangement/useCases/compingUseCases';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { notifyUser } from '#/helpers/Notification/notifyUser';

let timerId: ReturnType<typeof setTimeout> | null = null;
let lastTickTime = 0;
let accumulatedPosition = 0;
let lastScheduledBeat = -1;
let lastMetronomeBeat = -1;
const scheduledAudioClips = new Set<string>();
const scheduledFrozenTracks = new Set<string>();
const activeAudioSources: AudioBufferSourceNode[] = [];
let punchRecordingActive = false;
let punchRecordingClipIds: string[] = [];

const SCHEDULE_AHEAD_SECONDS = 0.1;
const MICRO_FADE_SECONDS = 0.003;
const DEFAULT_SCHEDULE_GRAIN_MS = 10;
function scheduleMetronome(
    fromBeat: number,
    toBeat: number,
    transport: NonNullable<typeof transportStore.value>,
    _currentTempo: number
): void {
    if (!transport.metronomeEnabled) {
        return;
    }

    const startBeatInt = Math.ceil(fromBeat);
    const endBeatInt = Math.floor(toBeat);
    const tsChanges = timeSignatureMapStore.value?.changes ?? [];

    for (let beat = startBeatInt; beat <= endBeatInt; beat++) {
        if (beat <= lastMetronomeBeat) {
            continue;
        }
        lastMetronomeBeat = beat;

        const beatTempo = getTempoAtBeat(tempoMapStore.value?.changes ?? [], beat, transport.tempo);
        const beatOffset = beat - accumulatedPosition;
        const time = getCurrentTime() + beatOffset / (beatTempo / 60);
        const ts = getTimeSignatureAtBeat(
            tsChanges,
            beat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const isAccent = beat % ts.numerator === 0;
        scheduleClick(time, isAccent, transport.metronomeVolume ?? 0.5);
    }
}

function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

function resolveDrumKitDef(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKitDef | null {
    const kitDevice = devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitDefByIndex(kitIndex);
}

function scheduleFrozenTrack(
    track: { id: string; frozenBufferId?: string },
    _fromBeat: number,
    currentTempo: number
): boolean {
    if (!track.frozenBufferId) {
        return false;
    }
    if (scheduledFrozenTracks.has(track.id)) {
        return true;
    }

    const buffer = audioBufferCache.get(track.frozenBufferId);
    if (!buffer) {
        return false;
    }

    scheduledFrozenTracks.add(track.id);

    const strip = ensureTrackStrip(track.id);
    const source = createBufferSource();
    source.buffer = buffer;

    source.connect(strip.gainNode);

    const beatOffset = 0 - accumulatedPosition;
    const startTime = getCurrentTime() + beatOffset / (currentTempo / 60);
    const now = getCurrentTime();

    if (startTime >= now) {
        source.start(startTime);
    } else {
        const elapsed = now - startTime;
        if (elapsed < buffer.duration) {
            source.start(now, elapsed);
        } else {
            return true;
        }
    }

    activeAudioSources.push(source);
    source.onended = () => {
        const idx = activeAudioSources.indexOf(source);
        if (idx >= 0) {
            activeAudioSources.splice(idx, 1);
        }
    };

    return true;
}

function scheduleMidiNotes(
    fromBeat: number,
    toBeat: number,
    transport: NonNullable<typeof transportStore.value>,
    currentTempo: number
): void {
    const tracks = trackStore.value?.tracks;
    const midiState = midiStore.value;
    if (!tracks || !midiState) {
        return;
    }

    const changes = tempoMapStore.value?.changes ?? [];

    for (const track of tracks) {
        if (track.kind !== 'midi' || track.muted) {
            continue;
        }

        if (track.frozen && track.frozenBufferId) {
            scheduleFrozenTrack(track, fromBeat, currentTempo);
            continue;
        }

        const drumKitDef = resolveDrumKitDef(track.devices);
        const drumKit = drumKitDef ? null : resolveDrumKit(track.devices);
        const resolvedClips = resolveClipsWithComping(track.id, track.clips);

        for (const clip of resolvedClips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type !== 'midi') {
                continue;
            }
            const notes = midiState.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const synthParams = (drumKit || drumKitDef) ? null : getSynthParamsForTrack(track.id);
            const compensation = getCompensationDelay(track.id);
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;

                for (const note of notes) {
                    if (note.startBeat >= loopLen) {
                        continue;
                    }

                    const noteStartBeat = clip.startBeat + iterOffset + note.startBeat;
                    if (noteStartBeat >= clip.endBeat) {
                        continue;
                    }

                    if (noteStartBeat >= fromBeat && noteStartBeat < toBeat && noteStartBeat > lastScheduledBeat) {
                        const probability = note.probability ?? 100;
                        if (probability < 100 && Math.random() * 100 >= probability) {
                            continue;
                        }

                        const noteTempo = getTempoAtBeat(changes, noteStartBeat, transport.tempo);
                        const noteBeatsPerSecond = noteTempo / 60;
                        const beatOffset = noteStartBeat - accumulatedPosition;
                        const time = getCurrentTime() + beatOffset / (currentTempo / 60) + compensation;
                        const noteEndBeat = Math.min(noteStartBeat + note.duration, clip.endBeat);
                        const duration = (noteEndBeat - noteStartBeat) / noteBeatsPerSecond;

                        const strip = ensureTrackStrip(track.id);

                        if (drumKitDef) {
                            // New dedicated drum synthesis engine (808-quality)
                            scheduleDrumKitNote(
                                getAudioContext(),
                                strip.gainNode,
                                drumKitDef,
                                note.pitch,
                                time,
                                note.velocity
                            );
                        } else if (drumKit) {
                            // Legacy synth-based fallback
                            scheduleKitNote(
                                getAudioContext(),
                                strip.gainNode,
                                drumKit,
                                note.pitch,
                                time,
                                duration,
                                note.velocity
                            );
                        } else {
                            const mpe =
                                note.pressure !== undefined || note.slide !== undefined || note.pitchBend !== undefined
                                    ? { pressure: note.pressure, slide: note.slide, pitchBend: note.pitchBend }
                                    : undefined;
                            scheduleNote(
                                getAudioContext(),
                                strip.gainNode,
                                note.pitch,
                                time,
                                duration,
                                note.velocity,
                                synthParams!,
                                mpe
                            );
                        }
                    }
                }
            }
        }
    }
}

function scheduleAudioClips(
    fromBeat: number,
    toBeat: number,
    transport: NonNullable<typeof transportStore.value>,
    currentTempo: number
): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const changes = tempoMapStore.value?.changes ?? [];

    for (const track of tracks) {
        if (track.kind !== 'audio' || track.muted) {
            continue;
        }

        if (track.frozen && track.frozenBufferId) {
            scheduleFrozenTrack(track, fromBeat, currentTempo);
            continue;
        }

        const compensation = getCompensationDelay(track.id);
        const resolvedAudioClips = resolveClipsWithComping(track.id, track.clips);

        for (const clip of resolvedAudioClips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type !== 'audio' || !clip.audioBufferId) {
                continue;
            }
            const clipKey = `${clip.id}:${clip.regionStartBeat}:${clip.regionEndBeat}`;
            if (scheduledAudioClips.has(clipKey)) {
                continue;
            }
            if (clip.startBeat > toBeat || clip.endBeat < fromBeat) {
                continue;
            }

            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                // If audioBufferId is a recording ID (starts with 'rec-'), don't permanently
                // skip — the buffer may not be ready yet. Re-try on next tick.
                const isRecordingClip = clip.audioBufferId.startsWith('rec-');
                if (!isRecordingClip) {
                    notifyUser(`Missing audio for clip "${clip.name}" — re-import the audio file`, 'warning');
                    scheduledAudioClips.add(clipKey);
                }
                continue;
            }

            scheduledAudioClips.add(clipKey);

            const strip = ensureTrackStrip(track.id);

            const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;

            const clipTempo = getTempoAtBeat(changes, clip.startBeat, transport.tempo);
            const clipBeatsPerSecond = clipTempo / 60;
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const clipDurationSeconds = clipVisualLength / clipBeatsPerSecond;

            const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            const loopLenSeconds = loopLen / clipBeatsPerSecond;
            const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffsetBeats = iter * loopLen;
                const iterStartBeat = clip.startBeat + iterOffsetBeats;
                if (iterStartBeat >= clip.endBeat) {
                    break;
                }

                const remainingBeats = clip.endBeat - iterStartBeat;
                const iterDurationBeats = Math.min(loopLen, remainingBeats);
                const iterDurationSeconds = iterDurationBeats / clipBeatsPerSecond;

                const source = createBufferSource();
                source.buffer = buffer;
                if (stretchRatio !== 1) {
                    source.playbackRate.value = stretchRatio;
                }

                const isFirstIter = iter === 0;
                const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;
                const hasExplicitFade = (isFirstIter && clip.fadeInBeats > 0) || (isLastIter && clip.fadeOutBeats > 0);
                const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
                const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;
                const needsFadeGain = hasExplicitFade || needsMicroFadeIn || needsMicroFadeOut;
                const fadeGain = needsFadeGain ? getAudioContext().createGain() : null;

                if (fadeGain) {
                    source.connect(fadeGain);
                    fadeGain.connect(strip.gainNode);
                } else {
                    source.connect(strip.gainNode);
                }

                const beatOffset = iterStartBeat - accumulatedPosition;
                const iterStartTime = getCurrentTime() + beatOffset / (currentTempo / 60) + compensation;
                const now = getCurrentTime();

                const playDuration = Math.min(iterDurationSeconds, buffer.duration / stretchRatio);

                if (iterStartTime >= now) {
                    source.start(iterStartTime, 0, playDuration * stretchRatio);
                } else {
                    const elapsed = now - iterStartTime;
                    const bufferOffset = elapsed * stretchRatio;
                    if (bufferOffset < buffer.duration && bufferOffset < playDuration * stretchRatio) {
                        source.start(now, bufferOffset, playDuration * stretchRatio - bufferOffset);
                    } else {
                        continue;
                    }
                }

                if (fadeGain) {
                    const effectiveStart = Math.max(iterStartTime, now);

                    if (isFirstIter && clip.fadeInBeats > 0) {
                        const fadeInEnd = iterStartTime + clip.fadeInBeats / clipBeatsPerSecond;
                        if (effectiveStart < fadeInEnd) {
                            const progressRatio =
                                Math.max(0, effectiveStart - iterStartTime) / (clip.fadeInBeats / clipBeatsPerSecond);
                            fadeGain.gain.setValueAtTime(progressRatio, effectiveStart);
                            fadeGain.gain.linearRampToValueAtTime(1, fadeInEnd);
                        } else {
                            fadeGain.gain.setValueAtTime(1, effectiveStart);
                        }
                    } else if (needsMicroFadeIn) {
                        fadeGain.gain.setValueAtTime(0, effectiveStart);
                        fadeGain.gain.linearRampToValueAtTime(1, effectiveStart + MICRO_FADE_SECONDS);
                    } else {
                        fadeGain.gain.setValueAtTime(1, effectiveStart);
                    }

                    if (isLastIter && clip.fadeOutBeats > 0) {
                        const clipEndTime =
                            getCurrentTime() +
                            (clip.endBeat - accumulatedPosition) / (currentTempo / 60) +
                            compensation;
                        const fadeOutStart = clipEndTime - clip.fadeOutBeats / clipBeatsPerSecond;
                        fadeGain.gain.setValueAtTime(1, Math.max(fadeOutStart, effectiveStart));
                        fadeGain.gain.linearRampToValueAtTime(0, clipEndTime);
                    } else if (needsMicroFadeOut) {
                        const iterEndTime = effectiveStart + playDuration;
                        fadeGain.gain.setValueAtTime(1, Math.max(effectiveStart, iterEndTime - MICRO_FADE_SECONDS));
                        fadeGain.gain.linearRampToValueAtTime(0, iterEndTime);
                    }
                }

                activeAudioSources.push(source);
                source.onended = () => {
                    const idx = activeAudioSources.indexOf(source);
                    if (idx >= 0) {
                        activeAudioSources.splice(idx, 1);
                    }
                    fadeGain?.disconnect();
                };
            }

            void clipDurationSeconds;
            void loopLenSeconds;
        }
    }
}

function applyVcaGains(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    for (const track of tracks) {
        if (!track.vcaGroupId || track.muted) {
            continue;
        }
        const effective = getEffectiveGain(track.id, track.gain);
        engineSetTrackGain(track.id, effective);
    }
}

function applyAutomation(currentBeat: number): void {
    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    const tracks = trackStore.value?.tracks;

    for (const lane of autoState.lanes) {
        if (lane.points.length === 0) {
            continue;
        }

        const track = tracks?.find((t) => t.id === lane.trackId);
        if (!track || track.automationMode === 'off') {
            continue;
        }

        if (lane.clipId) {
            const clip = track.clips.find((c) => c.id === lane.clipId);
            if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                continue;
            }
        }

        if (isRecordingAutomation(lane.trackId, lane.parameterId)) {
            continue;
        }

        const value = getAutomationValueAtBeat(lane.id, currentBeat);
        if (value === null) {
            continue;
        }

        if (lane.parameterId === 'gain') {
            engineSetTrackGain(lane.trackId, value);
        } else if (lane.parameterId === 'pan') {
            engineSetTrackPan(lane.trackId, value * 100 - 50);
        } else {
            for (const device of track.devices) {
                if (device.parameterValues[lane.parameterId] !== undefined) {
                    updateDeviceParam(lane.trackId, device.id, lane.parameterId, value);
                    break;
                }
            }
        }
    }
}

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
    lastMetronomeBeat = Math.floor(state.playheadPosition) - 1;

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
            lastMetronomeBeat = Math.floor(newPosition) - 1;
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
            lastMetronomeBeat = Math.floor(newPosition) - 1;
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

        scheduleMetronome(lastScheduledBeat, scheduleUpTo, current, currentTempo);
        scheduleMidiNotes(lastScheduledBeat, scheduleUpTo, current, currentTempo);
        scheduleAudioClips(lastScheduledBeat, scheduleUpTo, current, currentTempo);
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
    lastMetronomeBeat = -1;
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
