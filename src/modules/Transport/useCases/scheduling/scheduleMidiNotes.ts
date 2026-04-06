import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';
import { getTempoAtBeat } from '../../models/TempoMap';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import {
    ensureTrackStrip,
    setTrackGain as engineSetTrackGain,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getCurrentTime, createBufferSource } from '#/modules/AudioEngine/useCases/scheduling';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases/resolveComping';
import { scheduleNote, getSynthParamsForTrack } from '#/modules/Synth/useCases/builtinSynth';

// Transport-local shape (AGENTS.md §95 — derive from Synth's public use-case signature;
// params are passed opaquely to scheduleKitNote, no fields read here).
type SynthParams = ReturnType<typeof getSynthParamsForTrack>;
import { scheduleFaustNote } from '#/modules/Synth/useCases/faustInstrumentScheduler';
import { scheduleKitNote } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitByIndex } from '#/modules/AudioEngine/useCases/audioEngineQueries';

// Transport-local shape (AGENTS.md §95 — model isolation). Structurally compatible
// with the drum kit shape scheduleKitNote / getDrumKitByIndex operate on.
type DrumKit = {
    id: string;
    name: string;
    voices: Array<{ name: string; pitchRange: [number, number]; params: SynthParams }>;
};
import { getDrumKitDefByIndex, scheduleDrumKitNote } from '#/modules/Synth/useCases/drumSynthEngine/kitDefinitions';
import { getCompensationDelay } from '#/modules/AudioEngine/useCases/latencyCompensation/compensation';

// Transport-local shape (AGENTS.md §95 — derive from Synth's returned shape).
type DrumKitDef = NonNullable<ReturnType<typeof getDrumKitDefByIndex>>;
import { getChordAtBeat } from '#/modules/MIDI/useCases/chordTrack/getChordAtBeat';
import { transposeForChordTrack } from '#/modules/MIDI/useCases/transposeForChordTrack';
import { getYeastRack, getYeastWorkletNodeAsync } from '#/modules/Yeast/stores/yeastStore';
import { type MidiEvent, type TransportInfo } from '#/modules/Yeast/models/MidiEvent';

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export function resolveDrumKitDef(
    devices: { type: string; parameterValues: Record<string, number> }[]
): DrumKitDef | null {
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

    const fadeGain = getAudioContext().createGain();
    (source as any).fadeGainNode = fadeGain;
    fadeGain.connect(strip.gainNode);
    source.connect(fadeGain);

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

export async function scheduleMidiNotes(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    lastScheduledBeat: number,
    activeAudioSources: AudioBufferSourceNode[],
    transport: NonNullable<typeof transportStore.value>,
    currentTempo: number
): Promise<void> {
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
            let notes = midiState.notesByClipId[clip.id] as
                | NonNullable<(typeof midiState.notesByClipId)[string]>
                | undefined;
            if (!notes) {
                continue;
            }

            // ── Yeast MIDI FX processing ──
            // If this track has a Yeast device, run clip notes through the MIDI rack
            const hasYeast = track.devices.some((d) => d.type === 'yeast');
            if (hasYeast) {
                const yeastRack = getYeastRack();
                if (yeastRack.getProcessorIds().length > 0) {
                    const spb = transport.tempo / 60; // beats per second
                    const yeastSr = getAudioContext().sampleRate;
                    const yeastTransport: TransportInfo = {
                        sampleRate: yeastSr,
                        bpm: transport.tempo,
                        ppqPosition: fromBeat,
                        isPlaying: true,
                        barIndex: Math.floor(fromBeat / transport.timeSignatureNumerator),
                        beatInBar: fromBeat % transport.timeSignatureNumerator,
                        timeSigNum: transport.timeSignatureNumerator,
                        timeSigDen: transport.timeSignatureDenominator,
                        loopEnabled: transport.loopStart < transport.loopEnd,
                        loopStartPpq: transport.loopStart,
                        loopEndPpq: transport.loopEnd,
                    };

                    // Convert beat-based notes to sample-accurate MidiEvents
                    const midiEvents: MidiEvent[] = [];
                    for (const n of notes) {
                        const noteStartBeat = clip.startBeat + n.startBeat;
                        if (noteStartBeat < fromBeat || noteStartBeat >= toBeat) continue;
                        const timeSamples = Math.round((noteStartBeat * yeastSr) / spb);
                        midiEvents.push({
                            timeSamples,
                            kind: { type: 'noteOn', channel: 0, note: n.pitch, velocity: n.velocity ?? 100 },
                        });
                        const offTimeSamples = Math.round(((noteStartBeat + n.duration) * yeastSr) / spb);
                        midiEvents.push({
                            timeSamples: offTimeSamples,
                            kind: { type: 'noteOff', channel: 0, note: n.pitch },
                        });
                    }

                    const blockStartSamples = Math.round((fromBeat * yeastSr) / spb);
                    const blockEndSamples = Math.round((toBeat * yeastSr) / spb);
                    // Use the audio-thread worklet if available; fall back to sync main-thread rack.
                    const ctx = getAudioContext();
                    const workletNode = await getYeastWorkletNodeAsync(ctx);
                    const processed = workletNode
                        ? await workletNode.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport)
                        : yeastRack.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport);

                    // Convert back to beat-based notes for downstream scheduling
                    const transformedNotes: NonNullable<(typeof midiState.notesByClipId)[string]> = [];
                    for (const evt of processed) {
                        if (evt.kind.type === 'noteOn') {
                            const evtNote = evt.kind.note;
                            const evtVel = evt.kind.velocity;
                            const startBeat = (evt.timeSamples * spb) / yeastSr - clip.startBeat;
                            // Find matching Note Off
                            const offEvt = processed.find((e) => {
                                if (e.kind.type !== 'noteOff') return false;
                                return e.kind.note === evtNote && e.timeSamples > evt.timeSamples;
                            });
                            const endBeat = offEvt
                                ? (offEvt.timeSamples * spb) / yeastSr - clip.startBeat
                                : startBeat + 0.25;
                            transformedNotes.push({
                                ...notes![0]!,
                                pitch: evtNote,
                                velocity: evtVel,
                                startBeat,
                                duration: endBeat - startBeat,
                            });
                        }
                    }
                    notes = transformedNotes;
                }
            }

            const synthParams = drumKit || drumKitDef ? null : getSynthParamsForTrack(track.id);
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

                        let pitch = note.pitch;
                        if (track.followChordTrack && !drumKitDef && !drumKit) {
                            const refChord = getChordAtBeat(clip.startBeat);
                            const targetChord = getChordAtBeat(noteStartBeat);
                            pitch = transposeForChordTrack(pitch, refChord, targetChord);
                        }

                        const noteTempo = getTempoAtBeat(changes, noteStartBeat, transport.tempo);
                        const noteBeatsPerSecond = noteTempo / 60;
                        const beatOffset = noteStartBeat - accumulatedPosition;
                        const time = getCurrentTime() + beatOffset / (currentTempo / 60) + compensation;
                        const sr = getAudioContext().sampleRate;
                        const sampleFrame = Math.round(time * sr);
                        const noteEndBeat = Math.min(noteStartBeat + note.duration, clip.endBeat);
                        const duration = (noteEndBeat - noteStartBeat) / noteBeatsPerSecond;
                        const endSampleFrame = Math.round((time + duration) * sr);

                        const strip = ensureTrackStrip(track.id);

                        let isToasterChild = false;
                        let toasterParentTrack = null;

                        if (track.parentId) {
                            toasterParentTrack = tracks.find((t) => t.id === track.parentId);
                            if (toasterParentTrack?.devices.some((d) => d.type === 'toaster')) {
                                isToasterChild = true;
                            }
                        }

                        if (isToasterChild && toasterParentTrack) {
                            const toasterDevice = toasterParentTrack.devices.find((d) => d.type === 'toaster');
                            const parentStrip = ensureTrackStrip(toasterParentTrack.id);
                            if (toasterDevice && parentStrip) {
                                const dn = parentStrip.deviceNodes.find(
                                    (d) => d.deviceId === toasterDevice.id || d.type === 'toaster'
                                );
                                if (dn?.toasterControls) {
                                    const children = tracks.filter((t) => t.parentId === toasterParentTrack!.id);
                                    let pad = children.findIndex((t) => t.id === track.id);
                                    let pitchNote = pitch;

                                    if (pad === -1) {
                                        pad = pitch - 36;
                                        if (pad >= 24 && pad <= 39) {
                                            pad = pad - 24;
                                        }
                                        pitchNote = 60;
                                    }

                                    if (pad >= 0 && pad < 16) {
                                        const safeVelocity = note.velocity ?? 100;
                                        dn.toasterControls.noteOn(pad, safeVelocity, pitchNote, sampleFrame);
                                    }
                                }
                            }
                        } else if (drumKitDef) {
                            scheduleDrumKitNote(
                                getAudioContext(),
                                strip.gainNode,
                                drumKitDef,
                                pitch,
                                time,
                                note.velocity,
                                clip.gain
                            );
                        } else if (drumKit) {
                            scheduleKitNote(
                                getAudioContext(),
                                strip.gainNode,
                                drumKit,
                                pitch,
                                time,
                                duration,
                                note.velocity,
                                clip.gain
                            );
                        } else if (track.devices.some((d) => d.type === 'fermenter')) {
                            const fermenterDevice = track.devices.find((d) => d.type === 'fermenter');
                            if (fermenterDevice) {
                                const dn = strip.deviceNodes.find((d) => d.deviceId === fermenterDevice.id);
                                if (dn?.fermenterControls) {
                                    dn.fermenterControls.noteOn(pitch, note.velocity, sampleFrame);
                                    dn.fermenterControls.noteOff(pitch, endSampleFrame);
                                }
                            }
                        } else if (track.devices.some((d) => d.type === 'grand-boule')) {
                            const grandBouleDevice = track.devices.find((d) => d.type === 'grand-boule');
                            if (grandBouleDevice) {
                                const dn = strip.deviceNodes.find((d) => d.deviceId === grandBouleDevice.id);
                                if (dn?.grandBouleControls) {
                                    dn.grandBouleControls.noteOn(pitch, (note.velocity ?? 100) / 127, sampleFrame);
                                    dn.grandBouleControls.noteOff(pitch, endSampleFrame);
                                }
                            }
                        } else if (track.devices.some((d) => d.type === 'levain')) {
                            const levainDevice = track.devices.find((d) => d.type === 'levain');
                            if (levainDevice) {
                                const dn = strip.deviceNodes.find((d) => d.deviceId === levainDevice.id);
                                if (dn?.levainControls) {
                                    dn.levainControls.noteOn(pitch, note.velocity, sampleFrame);
                                    dn.levainControls.noteOff(pitch, endSampleFrame);
                                }
                            }
                        } else {
                            const faustDevice = track.devices.find((d) => d.type.startsWith('faust-'));
                            if (faustDevice) {
                                scheduleFaustNote(
                                    track.id,
                                    faustDevice.id,
                                    pitch,
                                    time,
                                    duration,
                                    note.velocity,
                                    clip.gain
                                );
                            } else {
                                const mpe =
                                    note.pressure !== undefined ||
                                    note.slide !== undefined ||
                                    note.pitchBend !== undefined
                                        ? { pressure: note.pressure, slide: note.slide, pitchBend: note.pitchBend }
                                        : undefined;
                                scheduleNote(
                                    getAudioContext(),
                                    strip.gainNode,
                                    pitch,
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
