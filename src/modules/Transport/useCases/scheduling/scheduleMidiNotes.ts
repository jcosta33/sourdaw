import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';
import { getTempoAtBeat } from '../../models/TempoMap';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { ensureTrackStrip, setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getCurrentTime, createBufferSource } from '#/modules/AudioEngine/useCases/scheduling';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases/resolveComping';
import { scheduleNote, getSynthParamsForTrack } from '#/modules/Synth/useCases/builtinSynth';
import { scheduleFaustNote } from '#/modules/Synth/useCases/faustInstrumentScheduler';
import { getDrumKitByIndex, scheduleKitNote, type DrumKit } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote, type DrumKitDef } from '#/modules/Synth/useCases/drumSynthEngine';
import { getCompensationDelay } from '#/modules/AudioEngine/useCases/latencyCompensation';

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export function resolveDrumKitDef(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKitDef | null {
    const kitDevice = devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitDefByIndex(kitIndex);
}

export function scheduleFrozenTrack(
    track: { id: string; frozenBufferId?: string },
    accumulatedPosition: number,
    activeAudioSources: AudioBufferSourceNode[],
    currentTempo: number
): boolean {
    if (!track.frozenBufferId) {
        return false;
    }

    const buffer = audioBufferCache.get(track.frozenBufferId);
    if (!buffer) {
        return false;
    }

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

export function scheduleMidiNotes(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    lastScheduledBeat: number,
    activeAudioSources: AudioBufferSourceNode[],
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
            scheduleFrozenTrack(track, accumulatedPosition, activeAudioSources, currentTempo);
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
                            scheduleDrumKitNote(
                                getAudioContext(),
                                strip.gainNode,
                                drumKitDef,
                                note.pitch,
                                time,
                                note.velocity,
                                clip.gain
                            );
                        } else if (drumKit) {
                            scheduleKitNote(
                                getAudioContext(),
                                strip.gainNode,
                                drumKit,
                                note.pitch,
                                time,
                                duration,
                                note.velocity,
                                clip.gain
                            );
                        } else if (track.devices.some((d) => d.type === 'fermenter')) {
                            // Fermenter synthesizer — send noteOn/noteOff via worklet MessagePort
                            const fermenterDevice = track.devices.find((d) => d.type === 'fermenter');
                            if (fermenterDevice) {
                                const dn = strip.deviceNodes.find((d) => d.deviceId === fermenterDevice.id);
                                if (dn?.fermenterControls) {
                                    const ctx = getAudioContext();
                                    const scheduleDelay = Math.max(0, time - ctx.currentTime);
                                    // Schedule noteOn at the precise time using setTimeout
                                    // (MessagePort messages can't be scheduled at a specific audio time)
                                    if (scheduleDelay <= 0) {
                                        dn.fermenterControls.noteOn(note.pitch, note.velocity);
                                        setTimeout(() => {
                                            dn.fermenterControls?.noteOff(note.pitch);
                                        }, duration * 1000);
                                    } else {
                                        setTimeout(() => {
                                            dn.fermenterControls?.noteOn(note.pitch, note.velocity);
                                            setTimeout(() => {
                                                dn.fermenterControls?.noteOff(note.pitch);
                                            }, duration * 1000);
                                        }, scheduleDelay * 1000);
                                    }
                                }
                            }
                        } else {
                            const faustDevice = track.devices.find((d) => d.type.startsWith('faust-'));
                            if (faustDevice) {
                                scheduleFaustNote(track.id, faustDevice.id, note.pitch, time, duration, note.velocity, clip.gain);
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
                                    mpe,
                                    clip.gain
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

// Re-export unused imports to satisfy the module graph until callers are updated
export { engineSetTrackGain, timeSignatureMapStore };
