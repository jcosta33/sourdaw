import { trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping, getSynthParamsForTrack, getGrooveOffsetAtBeat } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCompensationDelay,
    getCurrentTime,
    getDrumKitByIndex,
} from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getChordAtBeat, transposeForChordTrack } from '#/modules/MIDI/useCases';
import {
    getDrumKitDefByIndex,
    scheduleDrumKitNote,
    scheduleFaustNote,
    scheduleKitNote,
    scheduleNote,
} from '#/modules/Synth/useCases';
import { getYeastRack, getYeastWorkletNodeAsync } from '#/modules/Yeast/stores';

import { getTempoAtBeat } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { type SourceWithFade } from '../playheadScheduler';

import type { SynthParams } from '#/modules/AudioEngine/useCases';

// Worklet synth device types that share a common noteOn/noteOff controls interface.
// Each entry maps a device type to the controls property name on the device node
// and an optional velocity transform (defaults to identity).
type WorkletSynthEntry = {
    controlsKey: 'fermenterControls' | 'grandBouleControls' | 'levainControls';
    velocityTransform?: (velocity: number) => number;
};

const WORKLET_SYNTH_DEVICES: Record<string, WorkletSynthEntry> = {
    fermenter: { controlsKey: 'fermenterControls' },
    'grand-boule': {
        controlsKey: 'grandBouleControls',
        velocityTransform: (value: number) => value / 127,
    },
    levain: { controlsKey: 'levainControls' },
};

// Transport-local shape (AGENTS.md §95 — model isolation). Structurally compatible
// with the drum kit shape scheduleKitNote / getDrumKitByIndex operate on.
type DrumKit = {
    id: string;
    name: string;
    voices: Array<{ name: string; pitchRange: [number, number]; params: SynthParams }>;
};

// Transport-local shapes (AGENTS.md model isolation). Structurally compatible
// with what Yeast's processors and worklet accept; we do not import Yeast's model.
type YeastMidiEventKind =
    | { type: 'noteOn'; channel: number; note: number; velocity: number }
    | { type: 'noteOff'; channel: number; note: number }
    | { type: 'cc'; channel: number; cc: number; value: number }
    | { type: 'pitchBend'; channel: number; value: number }
    | { type: 'channelPressure'; channel: number; value: number };

type MidiEvent = {
    timeSamples: number;
    kind: YeastMidiEventKind;
};

type TransportInfo = {
    sampleRate: number;
    bpm: number;
    ppqPosition: number;
    isPlaying: boolean;
    barIndex: number;
    beatInBar: number;
    timeSigNum: number;
    timeSigDen: number;
    loopEnabled: boolean;
    loopStartPpq: number;
    loopEndPpq: number;
};

// Transport-local shape (AGENTS.md §95 — derive from Synth's returned shape).
type DrumKitDef = NonNullable<ReturnType<typeof getDrumKitDefByIndex>>;

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((data) => data.type === 'builtin-drum-kit' || data.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export function resolveDrumKitDef(
    devices: { type: string; parameterValues: Record<string, number> }[]
): DrumKitDef | null {
    const kitDevice = devices.find((data) => data.type === 'builtin-drum-kit' || data.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitDefByIndex(kitIndex);
}

/** Toaster parent-device note controls shape (local — cross-module model isolation). */
type ToasterControls = {
    noteOn: (pad: number, velocity: number, pitchNote: number, sampleFrame?: number) => void;
};

export function scheduleFrozenTrack(
    track: { id: string; freezeState: { status: string; frozenBufferId?: string } },
    accumulatedPosition: number,
    activeAudioSources: AudioBufferSourceNode[],
    currentTempo: number
): boolean {
    if (track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId) {
        return false;
    }

    const buffer = audioBufferCache.get(track.freezeState.frozenBufferId);
    if (!buffer) {
        return false;
    }

    const strip = ensureTrackStrip(track.id);
    const source = createBufferSource();
    source.buffer = buffer;

    const fadeGain = getAudioContext().createGain();
    (source as SourceWithFade).fadeGainNode = fadeGain;
    fadeGain.connect(strip.preFaderTap);
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
    transport: TransportState,
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

        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
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

            const hasYeast = track.devices.some((data) => data.type === 'yeast');
            if (hasYeast) {
                const yeastRack = getYeastRack();
                if (yeastRack.getProcessorIds().length > 0) {
                    const spb = transport.tempo / 60;
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

                    const midiEvents: MidiEvent[] = [];
                    for (const node of notes) {
                        const noteStartBeat = clip.startBeat + node.startBeat;
                        if (noteStartBeat < fromBeat || noteStartBeat >= toBeat) {
                            continue;
                        }
                        const timeSamples = Math.round((noteStartBeat * yeastSr) / spb);
                        midiEvents.push({
                            timeSamples,
                            kind: { type: 'noteOn', channel: 0, note: node.pitch, velocity: node.velocity ?? 100 },
                        });
                        const offTimeSamples = Math.round(((noteStartBeat + node.duration) * yeastSr) / spb);
                        midiEvents.push({
                            timeSamples: offTimeSamples,
                            kind: { type: 'noteOff', channel: 0, note: node.pitch },
                        });
                    }

                    const blockStartSamples = Math.round((fromBeat * yeastSr) / spb);
                    const blockEndSamples = Math.round((toBeat * yeastSr) / spb);
                    const ctx = getAudioContext();
                    const workletNode = await getYeastWorkletNodeAsync(ctx);
                    const processed = workletNode
                        ? await workletNode.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport)
                        : yeastRack.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport);

                    // §154.1 — Build a per-note index of noteOff events so the
                    // noteOn → noteOff match is O(1) instead of O(N) per noteOn.
                    // Events within `processed` are time-ordered by construction,
                    // so a single forward pass produces stacks of pending-off
                    // timeSamples per pitch. A noteOn then pops the earliest
                    // noteOff whose time > startTime.
                    const noteOffsByPitch = new Map<number, number[]>();
                    for (const evt of processed) {
                        if (evt.kind.type === 'noteOff') {
                            const existing = noteOffsByPitch.get(evt.kind.note);
                            if (existing) {
                                existing.push(evt.timeSamples);
                            } else {
                                noteOffsByPitch.set(evt.kind.note, [evt.timeSamples]);
                            }
                        }
                    }
                    const noteOffCursor = new Map<number, number>();

                    const transformedNotes: NonNullable<(typeof midiState.notesByClipId)[string]> = [];
                    for (const evt of processed) {
                        if (evt.kind.type === 'noteOn') {
                            const evtNote = evt.kind.note;
                            const evtVel = evt.kind.velocity;
                            const startBeat = (evt.timeSamples * spb) / yeastSr - clip.startBeat;

                            const offs = noteOffsByPitch.get(evtNote);
                            let offTime: number | null = null;
                            if (offs) {
                                let cursor = noteOffCursor.get(evtNote) ?? 0;
                                while (cursor < offs.length && offs[cursor]! <= evt.timeSamples) {
                                    cursor++;
                                }
                                if (cursor < offs.length) {
                                    offTime = offs[cursor]!;
                                    noteOffCursor.set(evtNote, cursor + 1);
                                } else {
                                    noteOffCursor.set(evtNote, cursor);
                                }
                            }
                            const endBeat =
                                offTime !== null ? (offTime * spb) / yeastSr - clip.startBeat : startBeat + 0.25;
                            transformedNotes.push({
                                ...notes[0]!,
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
            const strip = ensureTrackStrip(track.id);
            const ctx = getAudioContext();
            const sr = ctx.sampleRate;

            // §154.2 — Hoist parent-track + sibling-pad resolution out of the
            // per-note loop. These are functions of (track, tracks) only and
            // never change while we iterate notes.
            // §154.3 — Pre-resolve the per-track dispatch decision so the
            // note loop is a single switch instead of 4+ device array scans
            // per note (drumKitDef | drumKit | toasterChild | workletSynth |
            // faust | default synth).
            let toasterRoute: {
                controls: ToasterControls;
                pad: number;
                pitchFallback: number;
            } | null = null;
            if (track.parentId) {
                const toasterParentTrack = tracks.find((time1) => time1.id === track.parentId);
                const toasterDevice = toasterParentTrack?.devices.find((data) => data.type === 'toaster');
                if (toasterParentTrack && toasterDevice) {
                    const parentStrip = ensureTrackStrip(toasterParentTrack.id);
                    const dn = parentStrip?.deviceNodes.find(
                        (data) => data.deviceId === toasterDevice.id || data.type === 'toaster'
                    );
                    if (dn?.toasterControls) {
                        let pad = -1;
                        let childIdx = 0;
                        for (const time1 of tracks) {
                            if (time1.parentId === toasterParentTrack.id) {
                                if (time1.id === track.id) {
                                    pad = childIdx;
                                    break;
                                }
                                childIdx++;
                            }
                        }
                        toasterRoute = { controls: dn.toasterControls, pad, pitchFallback: 60 };
                    }
                }
            }

            const workletSynthDevice = toasterRoute
                ? null
                : track.devices.find((data) => data.type in WORKLET_SYNTH_DEVICES);
            const workletSynthEntry = workletSynthDevice
                ? (WORKLET_SYNTH_DEVICES[workletSynthDevice.type] ?? null)
                : null;
            const workletSynthNode = workletSynthDevice
                ? (strip.deviceNodes.find((data) => data.deviceId === workletSynthDevice.id) ?? null)
                : null;
            const workletSynthControls =
                workletSynthEntry && workletSynthNode
                    ? (workletSynthNode[workletSynthEntry.controlsKey] ?? null)
                    : null;

            const faustDevice =
                toasterRoute || drumKitDef || drumKit || workletSynthControls
                    ? null
                    : track.devices.find((data) => data.type.startsWith('faust-'));

            const midiOffset = clip.midiOffsetBeats ?? 0;

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;

                for (const note of notes) {
                    if (note.startBeat - midiOffset >= loopLen) {
                        continue;
                    }

                    const rawStartBeat = clip.startBeat + iterOffset + (note.startBeat - midiOffset);
                    const grooveOffset = getGrooveOffsetAtBeat(rawStartBeat);
                    const noteStartBeat = rawStartBeat + grooveOffset;

                    if (noteStartBeat >= clip.endBeat || noteStartBeat < clip.startBeat + iterOffset) {
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
                        const sampleFrame = Math.round(time * sr);
                        const noteEndBeat = Math.min(noteStartBeat + note.duration, clip.endBeat);
                        const duration = (noteEndBeat - noteStartBeat) / noteBeatsPerSecond;
                        const endSampleFrame = Math.round((time + duration) * sr);

                        if (toasterRoute) {
                            let pad = toasterRoute.pad;
                            let pitchNote = pitch;
                            if (pad === -1) {
                                pad = pitch - 36;
                                if (pad >= 24 && pad <= 39) {
                                    pad = pad - 24;
                                }
                                pitchNote = toasterRoute.pitchFallback;
                            }
                            if (pad >= 0 && pad < 16) {
                                const safeVelocity = note.velocity ?? 100;
                                toasterRoute.controls.noteOn(pad, safeVelocity, pitchNote, sampleFrame);
                            }
                        } else if (drumKitDef) {
                            scheduleDrumKitNote(ctx, strip.gainNode, drumKitDef, pitch, time, note.velocity, clip.gain);
                        } else if (drumKit) {
                            scheduleKitNote(
                                ctx,
                                strip.gainNode,
                                drumKit,
                                pitch,
                                time,
                                duration,
                                note.velocity,
                                clip.gain
                            );
                        } else if (workletSynthControls && workletSynthEntry) {
                            const rawVel = note.velocity ?? 100;
                            const vel = workletSynthEntry.velocityTransform
                                ? workletSynthEntry.velocityTransform(rawVel)
                                : rawVel;
                            workletSynthControls.noteOn(pitch, vel, sampleFrame);
                            workletSynthControls.noteOff(pitch, endSampleFrame);
                        } else if (faustDevice) {
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
                                note.pressure !== undefined || note.slide !== undefined || note.pitchBend !== undefined
                                    ? { pressure: note.pressure, slide: note.slide, pitchBend: note.pitchBend }
                                    : undefined;
                            scheduleNote(
                                ctx,
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
