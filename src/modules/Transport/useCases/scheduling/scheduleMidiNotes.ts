import { trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping, getSynthParamsForTrack, getGrooveOffsetAtBeat } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCompensationDelay,
    getCurrentTime,
    getDrumKitByIndex,
    scheduleFaustNote,
} from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getChordAtBeat, transposeForChordTrack } from '#/modules/MIDI/useCases';
import { getDrumKitDefByIndex, scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { getTempoAtBeat } from '../../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
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
    trackId?: string;
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

export type SchedulerCancellation = {
    generation: number;
    isCurrent: () => boolean;
};

// Transport-local shape (AGENTS.md §95 — derive from Synth's returned shape).
type DrumKitDef = NonNullable<ReturnType<typeof getDrumKitDefByIndex>>;

/**
 * Deterministic pseudo-random number from a clip id + position seed.
 * Mirrors evaluateFollowActions' seededRandom so per-note probability gates
 * replay identically across sessions instead of using Math.random() (§55.3).
 */
function seededRandom(clipId: string, position: number): number {
    let h = 2166136261;
    for (let index = 0; index < clipId.length; index++) {
        h ^= clipId.charCodeAt(index);
        h = Math.imul(h, 16777619);
    }
    h ^= Math.floor(position * 1e4) | 0;
    h = Math.imul(h, 16777619);
    // Fold to [0, 1).
    return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function isDrumDevice(deviceType: string): boolean {
    return (
        deviceType === 'builtin-drum-kit' || deviceType === 'drum-kit' || deviceType.startsWith('builtin-drum-machine')
    );
}

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((d) => isDrumDevice(d.type));
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export function resolveDrumKitDef(
    devices: { type: string; parameterValues: Record<string, number> }[]
): DrumKitDef | null {
    const kitDevice = devices.find((d) => isDrumDevice(d.type));
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
    track: { id: string; freezeState: { status: string; frozenBufferId?: string }; clips: { startBeat: number }[] },
    accumulatedPosition: number,
    activeAudioSources: AudioBufferSourceNode[],
    currentTempo: number
): boolean {
    if (track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId) {
        return false;
    }

    const buffer = getCachedAudioBuffer({ bufferId: track.freezeState.frozenBufferId });
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

    // The frozen buffer was rendered starting at the track's earliest clip
    // startBeat (see renderTrackOffline), not at beat 0. Offset playback by that
    // start beat so frozen tracks line up with the playhead instead of firing at
    // the project origin.
    const trackStartBeat = track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0;
    const beatOffset = trackStartBeat - accumulatedPosition;
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
    currentTempo: number,
    cancellation?: SchedulerCancellation
): Promise<void> {
    const isCurrent = cancellation?.isCurrent ?? (() => true);
    const tracks = trackStore.value?.tracks;
    const midiState = midiStore.value;
    if (!tracks || !midiState) {
        return;
    }

    const changes = tempoMapStore.value?.changes ?? [];

    for (const track of tracks) {
        if (!isCurrent()) {
            return;
        }
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
            const notes = midiState.notesByClipId[clip.id] as
                | NonNullable<(typeof midiState.notesByClipId)[string]>
                | undefined;
            if (!notes) {
                continue;
            }

            const hasYeast = track.devices.some((data) => data.type === 'yeast');
            // §2 — When the clip loops, run the Yeast worklet once per loop
            // iteration over that iteration's absolute window, so bar-aware
            // processors see iter-correct transport metadata instead of the
            // first iteration's bar replayed at every offset. The transformed
            // notes are emitted clip-relative (no iterOffset baked in), matching
            // what the per-note scheduling loop reconstructs below.
            // `notes` is narrowed non-undefined past the guard above; deriving the
            // iteration result type from it (rather than `typeof midiState.notesByClipId`)
            // avoids a `typeof` query on the still-nullable `midiState` binding, whose
            // declared type is not narrowed inside this type position.
            let runYeastForIteration: ((iterAbsBase: number) => Promise<typeof notes | null>) | null = null;
            const clipMidiOffset = clip.midiOffsetBeats ?? 0;
            if (hasYeast) {
                const rawNotes = notes;
                runYeastForIteration = async (iterAbsBase: number) => {
                    // Use the tempo map's value at the block start rather than
                    // the flat transport tempo, so beats↔samples conversion
                    // respects tempo changes within the project (§3).
                    const blockTempo = getTempoAtBeat(changes, fromBeat, transport.tempo);
                    const spb = blockTempo / 60;
                    const yeastSr = getAudioContext().sampleRate;
                    // §2 / audit row 2 — Bar index, beat-in-bar, and time
                    // signature must derive from the same authority the metronome
                    // uses (the time-signature map), not the flat transport
                    // numerator/denominator. Otherwise a bar-aware Yeast processor
                    // reads the wrong bar after a mid-project meter change while
                    // the metronome stays correct. `getBarBeatAtPosition` is the
                    // map-aware accumulator (1-indexed bar/beat + tick); convert to
                    // the worklet's 0-indexed convention. `tick` is 0..479 of a
                    // beat, so `(beat - 1) + tick/480` reconstructs the fractional
                    // 0-indexed beat-in-bar.
                    const tsChanges = timeSignatureMapStore.value?.changes ?? [];
                    const barBeat = getBarBeatAtPosition(
                        tsChanges,
                        fromBeat,
                        transport.timeSignatureNumerator,
                        transport.timeSignatureDenominator
                    );
                    const blockTimeSig = getTimeSignatureAtBeat(
                        tsChanges,
                        fromBeat,
                        transport.timeSignatureNumerator,
                        transport.timeSignatureDenominator
                    );
                    const yeastTransport: TransportInfo = {
                        sampleRate: yeastSr,
                        bpm: blockTempo,
                        ppqPosition: fromBeat,
                        isPlaying: true,
                        barIndex: barBeat.bar - 1,
                        beatInBar: barBeat.beat - 1 + barBeat.tick / 480,
                        timeSigNum: blockTimeSig.numerator,
                        timeSigDen: blockTimeSig.denominator,
                        loopEnabled: transport.loopStart < transport.loopEnd,
                        loopStartPpq: transport.loopStart,
                        loopEndPpq: transport.loopEnd,
                    };

                    const midiEvents: MidiEvent[] = [];
                    for (const node of rawNotes) {
                        // Map each source note to its absolute beat in *this*
                        // iteration so the worklet places it in the right bar.
                        const noteStartBeat = iterAbsBase + node.startBeat;
                        if (noteStartBeat < fromBeat || noteStartBeat >= toBeat) {
                            continue;
                        }
                        const timeSamples = Math.round((noteStartBeat * yeastSr) / spb);
                        midiEvents.push({
                            timeSamples,
                            trackId: track.id,
                            kind: { type: 'noteOn', channel: 0, note: node.pitch, velocity: node.velocity ?? 100 },
                        });
                        const offTimeSamples = Math.round(((noteStartBeat + node.duration) * yeastSr) / spb);
                        midiEvents.push({
                            timeSamples: offTimeSamples,
                            trackId: track.id,
                            kind: { type: 'noteOff', channel: 0, note: node.pitch },
                        });
                    }

                    const blockStartSamples = Math.round((fromBeat * yeastSr) / spb);
                    const blockEndSamples = Math.round((toBeat * yeastSr) / spb);
                    const ctx = getAudioContext();
                    const processed = await processYeastMidi({
                        context: ctx,
                        trackId: track.id,
                        events: midiEvents,
                        blockStartSamples,
                        blockEndSamples,
                        transport: yeastTransport,
                    });

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

                    // §6 — A Yeast generator (e.g. EuclideanGenerator) can emit
                    // notes even when the source clip has none. In that case
                    // `rawNotes[0]` is undefined and spreading it would yield
                    // notes missing id / probability / MPE fields. Use the first
                    // source note as a template when present, otherwise a
                    // fully-specified default so every generated note is a
                    // complete MidiNote.
                    const noteTemplate: NonNullable<(typeof midiState.notesByClipId)[string]>[number] = rawNotes[0] ?? {
                        id: clip.id,
                        pitch: 60,
                        startBeat: 0,
                        duration: 0,
                        velocity: 100,
                        probability: 100,
                    };

                    const transformedNotes: NonNullable<(typeof midiState.notesByClipId)[string]> = [];
                    for (const evt of processed) {
                        if (evt.kind.type === 'noteOn') {
                            const evtNote = evt.kind.note;
                            const evtVel = evt.kind.velocity;
                            // Emit the worklet output at its absolute beat, less
                            // the clip's MIDI content offset (preserving the
                            // original behaviour, which applied midiOffset to the
                            // worklet output). The per-note loop consumes these
                            // notes by their absolute beat directly — it does not
                            // re-apply iterOffset / midiOffset, since this
                            // iteration's run already placed them.
                            const startBeat = (evt.timeSamples * spb) / yeastSr - clipMidiOffset;

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
                                offTime !== null ? (offTime * spb) / yeastSr - clipMidiOffset : startBeat + 0.25;
                            transformedNotes.push({
                                ...noteTemplate,
                                id: `${noteTemplate.id}:yeast:${evtNote}:${evt.timeSamples}`,
                                pitch: evtNote,
                                velocity: evtVel,
                                startBeat,
                                duration: endBeat - startBeat,
                            });
                        }
                    }
                    return transformedNotes;
                };
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

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;

                // §2 — For a Yeast track, run the worklet per loop iteration with
                // iter-correct transport metadata. The returned notes carry their
                // absolute beat directly, so the per-note loop must not re-apply
                // iterOffset / midiOffset to them.
                const iterNotes = runYeastForIteration
                    ? await runYeastForIteration(clip.startBeat + iterOffset)
                    : notes;
                if (!isCurrent()) {
                    return;
                }
                if (!iterNotes) {
                    continue;
                }
                const notesAreAbsolute = runYeastForIteration !== null;

                for (const note of iterNotes) {
                    if (!notesAreAbsolute && note.startBeat - clipMidiOffset >= loopLen) {
                        continue;
                    }

                    const rawStartBeat = notesAreAbsolute
                        ? note.startBeat
                        : clip.startBeat + iterOffset + (note.startBeat - clipMidiOffset);
                    const grooveOffset = getGrooveOffsetAtBeat(rawStartBeat);
                    const iterationStart = clip.startBeat + iterOffset;
                    // A negative groove offset can move a note earlier than the
                    // iteration start. Clamp it to the iteration boundary rather
                    // than dropping it — silently skipping loses the note. Notes
                    // pushed past the clip end are genuinely out of range and stay
                    // dropped.
                    const noteStartBeat = Math.max(rawStartBeat + grooveOffset, iterationStart);

                    if (noteStartBeat >= clip.endBeat) {
                        continue;
                    }

                    if (noteStartBeat >= fromBeat && noteStartBeat < toBeat && noteStartBeat > lastScheduledBeat) {
                        if (!isCurrent()) {
                            return;
                        }
                        const probability = note.probability ?? 100;
                        if (probability < 100 && seededRandom(clip.id, noteStartBeat) * 100 >= probability) {
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
