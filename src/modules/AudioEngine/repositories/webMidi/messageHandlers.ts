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
    MIDI_NOTE_ON, MIDI_NOTE_OFF, MIDI_CC, MIDI_PITCH_BEND, MIDI_CHANNEL_PRESSURE, MPE_SLIDE_CC,
    type ActiveNoteData,
} from '#/modules/AudioEngine/models/WebMidiTypes';
import {
    activeNotes, channelToNote, mpeEnabled, targetTrackId,
} from './state';

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
    console.log(
        `[MIDI] noteOn: note=${note} vel=${velocity} targetTrack=${targetTrackId} ctxState=${audioEngine.context.state}`
    );
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
        const strip = engine.ensureTrackStrip(targetTrackId);
        
        let osc: OscillatorNode | null = null;
        const synthDevice = track?.devices.find((d) => d.type === 'builtin-drum-kit' || d.type.startsWith('builtin-drum-machine') || d.type.startsWith('builtin-synth'));
        
        if (synthDevice?.type === 'builtin-drum-kit' || synthDevice?.type.startsWith('builtin-drum-machine')) {
            const kitIndex = synthDevice.parameterValues['kit'] ?? 0;
            const kitDef = getDrumKitDefByIndex(kitIndex);
            if (kitDef) {
                scheduleDrumKitNote(
                    engine.context,
                    strip.gainNode,
                    kitDef,
                    note,
                    engine.context.currentTime,
                    velocity
                );
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

export function handlePitchBend(channel: number, lsb: number, msb: number): void {
    if (!mpeEnabled || channel < 1) {
        return;
    }

    const noteForChannel = channelToNote.get(channel);
    if (noteForChannel === undefined) {
        return;
    }

    const noteData = activeNotes.get(noteForChannel);
    if (noteData) {
        noteData.pitchBend = ((msb << 7) | lsb) - 8192;
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

    console.log(
        `[MIDI] message: type=0x${messageType.toString(16)} ch=${channel} data=[${Array.from(data).join(',')}]`
    );

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
