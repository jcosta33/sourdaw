/**
 * MIDI message handlers: noteOn, noteOff, CC, channel pressure, pitch bend.
 * Handles both live monitoring (oscillator playback) and recording (note creation).
 */
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import {
    getMidiStoreState,
    setMidiStoreState,
    getTrackStoreState,
    getMidiLearnState,
    createMidiNote,
} from '#/modules/Arrangement/useCases/trackQueries';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { completeMidiLearn, handleMidiMessage as applyMidiMappings } from '#/modules/MIDI/useCases/midiLearn';
import { getSynthParamsForTrack, scheduleNote } from '#/modules/Synth/useCases/builtinSynth';
import { getDrumKitByIndex, scheduleKitNote } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote } from '#/modules/Synth/useCases/drumSynthEngine';
import {
    MIDI_NOTE_ON,
    MIDI_NOTE_OFF,
    MIDI_CC,
    MIDI_PITCH_BEND,
    MIDI_CHANNEL_PRESSURE,
    MPE_SLIDE_CC,
    type ActiveNoteData,
} from '#/modules/AudioEngine/models/WebMidiTypes';
import { activeNotes, channelToNote, mpeEnabled, targetTrackId } from './state';

function secondsToBeats(seconds: number, tempo: number): number {
    return (seconds * tempo) / 60;
}

function findActiveRecordingClip(trackId: string): string | null {
    const trackState = getTrackStoreState();
    const transport = getTransportStoreValue();
    if (!trackState || !transport) {
        return null;
    }

    const track = trackState.tracks.find((t) => t.id === trackId);
    if (!track) {
        return null;
    }

    const midiClips = track.clips.filter((c) => c.type === 'midi');
    if (midiClips.length === 0) {
        return null;
    }

    if (transport.isRecording && transport.overdubEnabled) {
        const ph = playheadPositionRef.current;
        const intersecting = midiClips.find((c) => ph >= c.startBeat && ph <= c.endBeat);
        if (intersecting) {
            return intersecting.id;
        }

        if (transport.isLooping && ph >= transport.loopStart && ph <= transport.loopEnd) {
            const loopClip = midiClips.find(
                (c) => c.startBeat >= transport.loopStart && c.endBeat <= transport.loopEnd
            );
            if (loopClip) {
                return loopClip.id;
            }
        }
    }

    return midiClips[midiClips.length - 1]!.id;
}

export function handleNoteOn(channel: number, note: number, velocity: number): void {
    if (velocity === 0) {
        handleNoteOff(channel, note);
        return;
    }

    if (!targetTrackId) {
        console.warn('[MIDI] No target track set — select a MIDI track first');
        return;
    }

    const transport = getTransportStoreValue();
    const engine = audioEngine;
    const now = engine.context.currentTime;

    const noteData: ActiveNoteData = {
        startTime: now,
        startBeat: transport ? playheadPositionRef.current : 0,
        channel,
    };
    activeNotes.set(note, noteData);

    if (mpeEnabled && channel >= 1) {
        channelToNote.set(channel, note);
    }

    const trackState = getTrackStoreState();
    const track = trackState?.tracks.find((t) => t.id === targetTrackId);
    const isArmed = track?.armed ?? false;
    const isRecording = transport?.isRecording ?? false;

    if (!(isRecording && isArmed)) {

        // ── Resolve instrument track ────────────────────────────────────
        // A track may be:
        //   (a) A normal track with its own instrument device
        //   (b) A Grinder child track (no devices, parentId → Grinder parent)
        //   (c) Any other child track that routes to its parent's instrument
        //
        // For Grinder child tracks: the child represents ONE pad.
        // Any MIDI note on that child plays that pad's sound.
        // On the parent Grinder track: MIDI note selects the pad (GM drum map).

        let instrumentTrackId = targetTrackId;
        let instrumentTrack = track;
        let grinderChildPad: number | null = null;

        if (track && track.devices.length === 0 && track.parentId && trackState) {
            const parent = trackState.tracks.find((t) => t.id === track.parentId);
            if (parent) {
                instrumentTrackId = parent.id;
                instrumentTrack = parent;

                // If parent has a Grinder, determine which pad this child represents
                if (parent.devices.some((d) => d.type === 'grinder')) {
                    const children = trackState.tracks.filter(
                        (t) => t.parentId === parent.id
                    );
                    grinderChildPad = children.findIndex((t) => t.id === track.id);
                }
            }
        }

        const strip = engine.ensureTrackStrip(instrumentTrackId);

        // ── Route to the instrument on the resolved track ───────────────

        // Fermenter synth
        const fermenterDev = instrumentTrack?.devices.find((d) => d.type === 'fermenter');
        if (fermenterDev) {
            const dn = strip.deviceNodes.find((d) => d.deviceId === fermenterDev.id || d.type === 'fermenter');
            if (dn?.fermenterControls?.ready) {
                dn.fermenterControls.noteOn(note, velocity);
                noteData.fermenterDeviceId = fermenterDev.id;
                return;
            }
            return; // not ready — play nothing (don't fall through to wrong sound)
        }

        // Grinder drum machine
        const grinderDev = instrumentTrack?.devices.find((d) => d.type === 'grinder');
        if (grinderDev) {
            const dn = strip.deviceNodes.find((d) => d.deviceId === grinderDev.id || d.type === 'grinder');
            if (dn?.grinderControls?.ready) {
                // Child track → always play that child's pad, MIDI note controls pitch
                // Parent track → note selects the pad (GM drum map: C1=36 → pad 0)
                const pad = grinderChildPad ?? (note - 36);
                dn.grinderControls.noteOn(pad, velocity, note);
                noteData.grinderDeviceId = grinderDev.id;
                return;
            }
            return; // not ready
        }

        // Levain instrument
        const levainDev = instrumentTrack?.devices.find((d) => d.type === 'levain');
        if (levainDev) {
            const dn = strip.deviceNodes.find((d) => d.deviceId === levainDev.id || d.type === 'levain');
            if (dn?.levainControls?.ready) {
                dn.levainControls.noteOn(note, velocity);
                (noteData as Record<string, unknown>).levainDeviceId = levainDev.id;
                return;
            }
            return; // not ready
        }

        // ── Built-in synth / drum kit fallback ────────────────────────
        let osc: OscillatorNode | null = null;
        const synthDevice = instrumentTrack?.devices.find(
            (d) =>
                d.type === 'builtin-drum-kit' ||
                d.type.startsWith('builtin-drum-machine') ||
                d.type.startsWith('builtin-synth')
        );

        if (synthDevice?.type === 'builtin-drum-kit' || synthDevice?.type.startsWith('builtin-drum-machine')) {
            const kitIndex = synthDevice.parameterValues.kit ?? 0;
            const kitDef = getDrumKitDefByIndex(kitIndex);
            if (kitDef) {
                scheduleDrumKitNote(engine.context, strip.gainNode, kitDef, note, engine.context.currentTime, velocity);
            } else {
                const kit = getDrumKitByIndex(kitIndex);
                if (kit) {
                    osc = scheduleKitNote(
                        engine.context,
                        strip.gainNode,
                        kit,
                        note,
                        engine.context.currentTime,
                        60,
                        velocity
                    ) as OscillatorNode & { _env?: GainNode };
                }
            }
        } else {
            const synthParams = getSynthParamsForTrack(targetTrackId);
            osc = scheduleNote(
                engine.context,
                strip.gainNode,
                note,
                engine.context.currentTime,
                60,
                velocity,
                synthParams
            ) as OscillatorNode & { _env?: GainNode };
        }

        if (osc) {
            noteData.osc = osc;
        }
    }
}

export function handleNoteOff(_channel: number, note: number): void {
    const noteData = activeNotes.get(note);
    if (!noteData) {
        return;
    }

    activeNotes.delete(note);

    if (mpeEnabled) {
        channelToNote.delete(noteData.channel);
    }

    // Fermenter noteOff — send via worklet MessagePort
    if (noteData.fermenterDeviceId && targetTrackId) {
        const strip = audioEngine.getTrackStrip(targetTrackId);
        const dn = strip?.deviceNodes.find((d) => d.deviceId === noteData.fermenterDeviceId);
        if (dn?.fermenterControls) {
            dn.fermenterControls.noteOff(note);
        }
    }

    // Grinder noteOff — send via worklet MessagePort
    if (noteData.grinderDeviceId && targetTrackId) {
        const strip = audioEngine.getTrackStrip(targetTrackId);
        const dn = strip?.deviceNodes.find((d) => d.deviceId === noteData.grinderDeviceId);
        if (dn?.grinderControls) {
            const pad = note - 36;
            dn.grinderControls.noteOff(pad);
        }
    }

    // Levain noteOff — send via worklet MessagePort
    if ((noteData as any).levainDeviceId && targetTrackId) {
        const strip = audioEngine.getTrackStrip(targetTrackId);
        const dn = strip?.deviceNodes.find((d) => d.deviceId === (noteData as any).levainDeviceId);
        if (dn?.levainControls) {
            dn.levainControls.noteOff(note);
        }
    }

    if (noteData.osc) {
        const now = audioEngine.context.currentTime;
        const synthParams = targetTrackId ? getSynthParamsForTrack(targetTrackId) : null;
        const releaseTime = synthParams?.release ?? 0.3;
        if (noteData.osc._env) {
            noteData.osc._env.gain.cancelScheduledValues(now);
            noteData.osc._env.gain.setTargetAtTime(0, now, releaseTime / 3);
        }
        try {
            noteData.osc.stop(now + releaseTime + 0.05);
        } catch {
            // already stopped
        }
    }

    if (!targetTrackId) {
        return;
    }

    const transport = getTransportStoreValue();
    const trackState = getTrackStoreState();
    const track = trackState?.tracks.find((t) => t.id === targetTrackId);
    const isArmed = track?.armed ?? false;
    const isRecording = transport?.isRecording ?? false;

    if (isRecording && isArmed) {
        const clipId = findActiveRecordingClip(targetTrackId);
        if (!clipId) {
            return;
        }

        const tempo = transport?.tempo ?? 120;
        const durationSeconds = audioEngine.context.currentTime - noteData.startTime;
        const durationBeats = secondsToBeats(durationSeconds, tempo);

        const midiNote = createMidiNote(note, noteData.startBeat, Math.max(durationBeats, 0.0625), 100);

        if (mpeEnabled) {
            if (noteData.pressure !== undefined) {
                midiNote.pressure = noteData.pressure;
            }
            if (noteData.slide !== undefined) {
                midiNote.slide = noteData.slide;
            }
            if (noteData.pitchBend !== undefined) {
                midiNote.pitchBend = noteData.pitchBend;
            }
        }

        const midiState = getMidiStoreState();
        if (!midiState) {
            return;
        }

        const existing = midiState.notesByClipId[clipId] ?? [];
        setMidiStoreState({
            ...midiState,
            notesByClipId: {
                ...midiState.notesByClipId,
                [clipId]: [...existing, midiNote],
            },
        });
    }
}

export function handleCC(channel: number, cc: number, value: number): void {
    const learnState = getMidiLearnState();
    if (learnState?.isLearning && learnState.learningTarget) {
        completeMidiLearn(channel, cc);
        return;
    }

    if (mpeEnabled && cc === MPE_SLIDE_CC && channel >= 1) {
        const noteForChannel = channelToNote.get(channel);
        if (noteForChannel !== undefined) {
            const noteData = activeNotes.get(noteForChannel);
            if (noteData) {
                noteData.slide = value;
            }
        }
        return;
    }

    applyMidiMappings(channel, cc, value);

    if (!targetTrackId) {
        return;
    }

    if (cc === 7) {
        audioEngine.setTrackGain(targetTrackId, value / 127);
    } else if (cc === 10) {
        audioEngine.setTrackPan(targetTrackId, ((value / 127) * 2 - 1) * 50);
    }

    // Forward expression CCs (CC1, CC2, CC11, CC64) to levain engine
    const trackState = getTrackStoreState();
    const track = trackState?.tracks.find((t) => t.id === targetTrackId);
    const levainDevice = track?.devices.find((d) => d.type === 'levain');
    if (levainDevice) {
        const strip = audioEngine.getTrackStrip(targetTrackId);
        const dn = strip?.deviceNodes.find((d) => d.deviceId === levainDevice.id || d.type === 'levain');
        if (dn?.levainControls?.ready) {
            dn.levainControls.handleCc(cc, value);
        }
    }
}

export function handleChannelPressure(channel: number, pressure: number): void {
    if (!mpeEnabled || channel < 1) {
        return;
    }

    const noteForChannel = channelToNote.get(channel);
    if (noteForChannel === undefined) {
        return;
    }

    const noteData = activeNotes.get(noteForChannel);
    if (noteData) {
        noteData.pressure = pressure;
    }
}

// Standard MIDI pitch bend range: ±2 semitones (200 cents). Widely used default.
const STANDARD_BEND_RANGE_CENTS = 200;
// MPE per-note bend range: ±48 semitones, matching builtinSynth.ts convention.
const MPE_BEND_RANGE_CENTS = 48 * 100;

export function handlePitchBend(channel: number, lsb: number, msb: number): void {
    // Raw 14-bit pitch bend: range 0–16383, centre at 8192.
    const bendValue = ((msb << 7) | lsb) - 8192; // -8192 … +8191

    if (mpeEnabled && channel >= 1) {
        // MPE mode: pitch bend is per-note, keyed by channel.
        const noteForChannel = channelToNote.get(channel);
        if (noteForChannel === undefined) {
            return;
        }
        const noteData = activeNotes.get(noteForChannel);
        if (!noteData) {
            return;
        }
        noteData.pitchBend = bendValue;
        if (noteData.osc) {
            const bendCents = (bendValue / 8192) * MPE_BEND_RANGE_CENTS;
            const baseDetune = targetTrackId ? getSynthParamsForTrack(targetTrackId).detune : 0;
            noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, audioEngine.context.currentTime, 0.003);
        }
        return;
    }

    // Standard MIDI: pitch bend on channel 0 is a global message — apply to
    // every active note. This is what a conventional keyboard pitch wheel does.
    const bendCents = (bendValue / 8192) * STANDARD_BEND_RANGE_CENTS;
    const baseDetune = targetTrackId ? getSynthParamsForTrack(targetTrackId).detune : 0;
    const now = audioEngine.context.currentTime;
    for (const noteData of activeNotes.values()) {
        if (noteData.osc) {
            noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, now, 0.003);
        }
    }
}

export function onMidiMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) {
        return;
    }

    const status = data[0]!;
    const messageType = status & 0xf0;
    const channel = status & 0x0f;

    switch (messageType) {
        case MIDI_NOTE_ON:
            handleNoteOn(channel, data[1]!, data[2] ?? 0);
            break;
        case MIDI_NOTE_OFF:
            handleNoteOff(channel, data[1]!);
            break;
        case MIDI_CC:
            handleCC(channel, data[1]!, data[2] ?? 0);
            break;
        case MIDI_CHANNEL_PRESSURE:
            handleChannelPressure(channel, data[1]!);
            break;
        case MIDI_PITCH_BEND:
            handlePitchBend(channel, data[1]!, data[2] ?? 0);
            break;
    }
}
