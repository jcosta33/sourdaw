/**
 * MIDI message handlers: noteOn, noteOff, CC, channel pressure, pitch bend.
 * Handles both live monitoring (oscillator playback) and recording (note creation).
 *
 * Handlers share module-local MIDI routing state. Some exports use `inject({ logger })` or
 * `inject(midiMessageHandlerDependencies)` for test overrides and lazy resolution.
 */
import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { getTrackStoreState, getSynthParamsForTrack } from '#/modules/Arrangement/useCases';
import { createGrandBouleStore } from '#/modules/GrandBoule/stores';
import { applyVelocityCurve } from '#/modules/GrandBoule/useCases';
import {
    completeMidiLearn,
    createMidiNote,
    getMidiLearnState,
    getMidiStoreState,
    handleMidiMessage as applyMidiMappings,
    setMidiStoreState,
    stepRecordNoteOn,
    stepRecordNoteOff,
} from '#/modules/MIDI/useCases';
import { getDrumKitDefByIndex, scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';
import { playheadPositionRef } from '#/modules/Transport/stores';
import { getTransportStoreValue } from '#/modules/Transport/useCases';
import { processRealtimeMidiInput } from '#/modules/Yeast/useCases';

import { getDrumKitByIndex } from '../../models/factoryDrumKits';
import {
    MIDI_NOTE_ON,
    MIDI_NOTE_OFF,
    MIDI_CC,
    MIDI_PITCH_BEND,
    MIDI_CHANNEL_PRESSURE,
    MPE_SLIDE_CC,
    type ActiveNoteData,
} from '../../models/WebMidiTypes';
import { getCompensationDelay } from '../../useCases/latencyCompensation/compensation/getCompensationDelay';
import { audioEngine } from '../createWebAudioEngine';

import { activeNotes, channelToNote, getMpeEnabled, getTargetTrackId } from './state';

const midiMessageHandlerDependencies = {
    getCompensationDelay,
    getMidiStoreState,
    setMidiStoreState,
    getTrackStoreState,
    getMidiLearnState,
    createMidiNote,
    getTransportStoreValue,
    playheadPositionRef,
    completeMidiLearn,
    applyMidiMappings,
    getSynthParamsForTrack,
    scheduleNote,
    scheduleKitNote,
    getDrumKitByIndex,
    getDrumKitDefByIndex,
    scheduleDrumKitNote,
    processRealtimeMidiInput,
    stepRecordNoteOn,
    stepRecordNoteOff,
    eventBus,
};

function secondsToBeats(seconds: number, tempo: number): number {
    return (seconds * tempo) / 60;
}

export const handleNoteOff = inject(midiMessageHandlerDependencies)((deps) => {
    function findActiveRecordingClip(trackId: string): string | null {
        const trackState = deps.getTrackStoreState();
        const transport = deps.getTransportStoreValue();
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
            const ph = deps.playheadPositionRef.current;
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

    return function handleNoteOff(_channel: number, note: number): void {
        deps.stepRecordNoteOff(note);
        const noteData = activeNotes.get(note);
        if (!noteData) {
            return;
        }

        activeNotes.delete(note);

        if (getMpeEnabled()) {
            channelToNote.delete(noteData.channel);
        }

        if (noteData.fermenterDeviceId && getTargetTrackId()) {
            const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
            const dn = strip?.deviceNodes.find((d) => d.deviceId === noteData.fermenterDeviceId);
            if (dn?.fermenterControls) {
                dn.fermenterControls.noteOff(note);
            }
        }

        if (noteData.toasterDeviceId && getTargetTrackId()) {
            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((t) => t.id === getTargetTrackId());
            let instrumentTrackId = getTargetTrackId()!;
            let toasterChildPad: number | null = null;

            if (track && track.devices.length === 0 && track.parentId && trackState) {
                // Single pass: find parent + child pad index, instead of
                // `find()` + `filter()` + `findIndex()` (§80.4).
                let parent: typeof track | undefined;
                let padIdx = 0;
                for (const t of trackState.tracks) {
                    if (t.id === track.parentId) {
                        parent = t;
                    } else if (t.parentId === track.parentId) {
                        if (t.id === track.id) {
                            toasterChildPad = padIdx;
                        }
                        padIdx++;
                    }
                }
                if (parent?.devices.some((d) => d.type === 'toaster')) {
                    instrumentTrackId = parent.id;
                } else {
                    toasterChildPad = null;
                }
            }

            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const dn = strip?.deviceNodes.find((d) => d.deviceId === noteData.toasterDeviceId);
            if (dn?.toasterControls) {
                let pad = toasterChildPad;
                if (pad === null || pad === -1) {
                    pad = note - 36;
                    if (pad >= 24 && pad <= 39) {
                        pad = pad - 24;
                    }
                }
                if (pad >= 0 && pad < 16) {
                    dn.toasterControls.noteOff(pad);
                }
            }
        }

        if (noteData.grandBouleDeviceId && getTargetTrackId()) {
            const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
            const dn = strip?.deviceNodes.find((d) => d.deviceId === noteData.grandBouleDeviceId);
            if (dn?.grandBouleControls) {
                dn.grandBouleControls.noteOff(note);
            }
            void deps.eventBus.emit('midi.noteOff', { midiNote: note });
        }

        if (noteData.levainDeviceId && getTargetTrackId()) {
            const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
            const levainId = noteData.levainDeviceId;
            const dn = strip?.deviceNodes.find((d) => d.deviceId === levainId);
            if (dn?.levainControls) {
                dn.levainControls.noteOff(note);
            }
        }

        if (noteData.osc) {
            const now = audioEngine.context.currentTime;
            const synthParams = getTargetTrackId() ? deps.getSynthParamsForTrack(getTargetTrackId()!) : null;
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

        if (!getTargetTrackId()) {
            return;
        }

        const transport = deps.getTransportStoreValue();
        const trackState = deps.getTrackStoreState();
        const track = trackState?.tracks.find((t) => t.id === getTargetTrackId());
        const isArmed = track?.armed ?? false;
        const isRecording = transport?.isRecording ?? false;

        if (isRecording && isArmed) {
            const trackId = getTargetTrackId();
            const clipId = trackId ? findActiveRecordingClip(trackId) : null;
            if (!clipId || !trackId) {
                return;
            }

            const tempo = transport?.tempo ?? 120;
            const durationSeconds = audioEngine.context.currentTime - noteData.startTime;
            const durationBeats = secondsToBeats(durationSeconds, tempo);

            const trackLatencySec = getCompensationDelay(trackId);
            const ctx = audioEngine.context;
            const totalLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0) + trackLatencySec;
            const offsetBeats = secondsToBeats(totalLatencySec, tempo);
            const compensatedStartBeat = Math.max(0, noteData.startBeat - offsetBeats);

            const midiNote = deps.createMidiNote(note, compensatedStartBeat, Math.max(durationBeats, 0.0625), 100);

            if (getMpeEnabled()) {
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

            const midiState = deps.getMidiStoreState();
            if (!midiState) {
                return;
            }

            const existing = midiState.notesByClipId[clipId] ?? [];
            deps.setMidiStoreState({
                ...midiState,
                notesByClipId: {
                    ...midiState.notesByClipId,
                    [clipId]: [...existing, midiNote],
                },
            });
        }
    };
});

export const handleNoteOn = inject({
    ...midiMessageHandlerDependencies,
    handleNoteOff,
})(
    ({ handleNoteOff, ...deps }) =>
        function handleNoteOn(channel: number, note: number, velocity: number): void {
            if (velocity === 0) {
                handleNoteOff(channel, note);
                return;
            }

            deps.stepRecordNoteOn(note, velocity);

            if (!getTargetTrackId()) {
                logger.warn('[MIDI] No target track set — select a MIDI track first');
                return;
            }

            const transport = deps.getTransportStoreValue();
            const engine = audioEngine;
            const now = engine.context.currentTime;

            const noteData: ActiveNoteData = {
                startTime: now,
                startBeat: transport ? deps.playheadPositionRef.current : 0,
                channel,
            };
            activeNotes.set(note, noteData);

            if (getMpeEnabled() && channel >= 1) {
                channelToNote.set(channel, note);
            }

            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((t) => t.id === getTargetTrackId());

            let instrumentTrackId = getTargetTrackId()!;
            let instrumentTrack = track;
            let toasterChildPad: number | null = null;

            if (track && track.parentId && trackState) {
                // Single pass instead of find() + filter() + findIndex() (§80.4).
                let parent: typeof track | undefined;
                let padIdx = 0;
                for (const t of trackState.tracks) {
                    if (t.id === track.parentId) {
                        parent = t;
                    } else if (t.parentId === track.parentId) {
                        if (t.id === track.id) {
                            toasterChildPad = padIdx;
                        }
                        padIdx++;
                    }
                }
                if (parent?.devices.some((d) => d.type === 'toaster')) {
                    instrumentTrackId = parent.id;
                    instrumentTrack = parent;
                } else {
                    toasterChildPad = null;
                }
            }

            const strip = engine.ensureTrackStrip(instrumentTrackId);

            const hasYeast = instrumentTrack?.devices.some((d) => d.type === 'yeast');
            if (hasYeast) {
                const sampleTime = Math.round(now * engine.context.sampleRate);
                const processedEvents = deps.processRealtimeMidiInput(note, velocity, channel, true, sampleTime);
                for (const evt of processedEvents) {
                    if (evt.kind.type === 'noteOn') {
                        const evtNote = evt.kind.note;
                        const evtVel = evt.kind.velocity;
                        const fDev = instrumentTrack?.devices.find((d) => d.type === 'fermenter');
                        if (fDev) {
                            const dn = strip.deviceNodes.find((d) => d.type === 'fermenter');
                            dn?.fermenterControls?.noteOn(evtNote, evtVel);
                            continue;
                        }
                        const gbDev = instrumentTrack?.devices.find((d) => d.type === 'grand-boule');
                        if (gbDev) {
                            const dn = strip.deviceNodes.find((d) => d.type === 'grand-boule');
                            dn?.grandBouleControls?.noteOn(evtNote, evtVel / 127);
                            deps.eventBus.emit('midi.noteOn', { midiNote: evtNote, velocity: evtVel / 127 });
                            continue;
                        }
                        const lDev = instrumentTrack?.devices.find((d) => d.type === 'levain');
                        if (lDev) {
                            const dn = strip.deviceNodes.find((d) => d.type === 'levain');
                            dn?.levainControls?.noteOn(evtNote, evtVel);
                            continue;
                        }
                        const sp = deps.getSynthParamsForTrack(instrumentTrackId);
                        if (sp) {
                            deps.scheduleNote(engine.context, strip.gainNode, evtNote, now, 0.5, evtVel, sp);
                        }
                    } else if (evt.kind.type === 'noteOff') {
                        const evtNote = evt.kind.note;
                        const fDev = instrumentTrack?.devices.find((d) => d.type === 'fermenter');
                        if (fDev) {
                            const dn = strip.deviceNodes.find((d) => d.type === 'fermenter');
                            dn?.fermenterControls?.noteOff(evtNote);
                            continue;
                        }
                        const gbDev2 = instrumentTrack?.devices.find((d) => d.type === 'grand-boule');
                        if (gbDev2) {
                            const dn = strip.deviceNodes.find((d) => d.type === 'grand-boule');
                            dn?.grandBouleControls?.noteOff(evtNote);
                            deps.eventBus.emit('midi.noteOff', { deviceId: gbDev2.id, midiNote: evtNote });
                            continue;
                        }
                        const lDev = instrumentTrack?.devices.find((d) => d.type === 'levain');
                        if (lDev) {
                            const dn = strip.deviceNodes.find((d) => d.type === 'levain');
                            dn?.levainControls?.noteOff(evtNote);
                            continue;
                        }
                    }
                }
                return;
            }

            const fermenterDev = instrumentTrack?.devices.find((d) => d.type === 'fermenter');
            if (fermenterDev) {
                const dn = strip.deviceNodes.find((d) => d.deviceId === fermenterDev.id || d.type === 'fermenter');
                if (dn?.fermenterControls?.ready) {
                    dn.fermenterControls.noteOn(note, velocity);
                    noteData.fermenterDeviceId = fermenterDev.id;
                }
                return;
            }

            const toasterDev = instrumentTrack?.devices.find((d) => d.type === 'toaster');
            if (toasterDev) {
                const dn = strip.deviceNodes.find((d) => d.deviceId === toasterDev.id || d.type === 'toaster');
                if (dn?.toasterControls) {
                    let pad = toasterChildPad;
                    let pitchNote = note;

                    if (pad === null || pad === -1) {
                        pad = note - 36;
                        if (pad >= 24 && pad <= 39) {
                            pad = pad - 24;
                        }
                        pitchNote = 60;
                    }
                    if (pad >= 0 && pad < 16) {
                        dn.toasterControls.noteOn(pad, velocity, pitchNote);
                        noteData.toasterDeviceId = toasterDev.id;
                    }
                }
                return;
            }

            const grandBouleDev = instrumentTrack?.devices.find((d) => d.type === 'grand-boule');
            if (grandBouleDev) {
                const dn = strip.deviceNodes.find((d) => d.deviceId === grandBouleDev.id || d.type === 'grand-boule');
                if (dn?.grandBouleControls?.ready) {
                    const gbStore = createGrandBouleStore(grandBouleDev.id);
                    const calibration = gbStore.value?.midiCalibration;
                    const finalVelocity = calibration ? applyVelocityCurve(velocity, calibration) : velocity / 127;
                    dn.grandBouleControls.noteOn(note, finalVelocity);
                    noteData.grandBouleDeviceId = grandBouleDev.id;
                    deps.eventBus.emit('midi.noteOn', {
                        deviceId: grandBouleDev.id,
                        midiNote: note,
                        velocity: finalVelocity,
                    });
                }
                return;
            }

            const levainDev = instrumentTrack?.devices.find((d) => d.type === 'levain');
            if (levainDev) {
                const dn = strip.deviceNodes.find((d) => d.deviceId === levainDev.id || d.type === 'levain');
                if (dn?.levainControls?.ready) {
                    dn.levainControls.noteOn(note, velocity);
                    noteData.levainDeviceId = levainDev.id;
                    return;
                }
                return;
            }

            let osc: OscillatorNode | null = null;
            const synthDevice = instrumentTrack?.devices.find(
                (d) =>
                    d.type === 'builtin-drum-kit' ||
                    d.type.startsWith('builtin-drum-machine') ||
                    d.type.startsWith('builtin-synth')
            );

            if (synthDevice?.type === 'builtin-drum-kit' || synthDevice?.type.startsWith('builtin-drum-machine')) {
                const kitIndex = synthDevice.parameterValues.kit ?? 0;
                const kitDef = deps.getDrumKitDefByIndex(kitIndex);
                if (kitDef) {
                    deps.scheduleDrumKitNote(
                        engine.context,
                        strip.gainNode,
                        kitDef,
                        note,
                        engine.context.currentTime,
                        velocity
                    );
                } else {
                    const kit = deps.getDrumKitByIndex(kitIndex);
                    if (kit) {
                        osc = deps.scheduleKitNote(
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
                const synthParams = deps.getSynthParamsForTrack(getTargetTrackId()!);
                osc = deps.scheduleNote(
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
);

export const handleCC = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function handleCC(channel: number, cc: number, value: number): void {
            const learnState = deps.getMidiLearnState();
            if (learnState?.isLearning && learnState.learningTarget) {
                deps.completeMidiLearn(channel, cc);
                return;
            }

            if (getMpeEnabled() && cc === MPE_SLIDE_CC && channel >= 1) {
                const noteForChannel = channelToNote.get(channel);
                if (noteForChannel !== undefined) {
                    const noteData = activeNotes.get(noteForChannel);
                    if (noteData) {
                        noteData.slide = value;
                    }
                }
                return;
            }

            deps.applyMidiMappings(channel, cc, value);

            if (!getTargetTrackId()) {
                return;
            }

            if (cc === 7) {
                audioEngine.setTrackGain(getTargetTrackId()!, value / 127);
            } else if (cc === 10) {
                audioEngine.setTrackPan(getTargetTrackId()!, ((value / 127) * 2 - 1) * 50);
            }

            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((t) => t.id === getTargetTrackId());
            const grandBouleDevice = track?.devices.find((d) => d.type === 'grand-boule');
            if (grandBouleDevice) {
                const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
                const dn = strip?.deviceNodes.find(
                    (d) => d.deviceId === grandBouleDevice.id || d.type === 'grand-boule'
                );
                if (dn?.grandBouleControls?.ready) {
                    if (cc === 64) {
                        dn.grandBouleControls.setSustain(value / 127);
                        deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 64,
                            value: value / 127,
                        });
                    } else if (cc === 66) {
                        dn.grandBouleControls.setSostenuto(value >= 64);
                        deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 66,
                            value: value >= 64,
                        });
                    } else if (cc === 67) {
                        dn.grandBouleControls.setUnaCorda(value >= 64);
                        deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 67,
                            value: value >= 64,
                        });
                    }
                }
            }

            const levainDevice = track?.devices.find((d) => d.type === 'levain');
            if (levainDevice) {
                const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
                const dn = strip?.deviceNodes.find((d) => d.deviceId === levainDevice.id || d.type === 'levain');
                if (dn?.levainControls?.ready) {
                    dn.levainControls.handleCc(cc, value);
                }
            }
        }
);

export function handleChannelPressure(channel: number, pressure: number): void {
    if (!getMpeEnabled() || channel < 1) {
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

const STANDARD_BEND_RANGE_CENTS = 200;
const MPE_BEND_RANGE_CENTS = 48 * 100;

export const handlePitchBend = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function handlePitchBend(channel: number, lsb: number, msb: number): void {
            const bendValue = ((msb << 7) | lsb) - 8192;

            if (getMpeEnabled() && channel >= 1) {
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
                    const baseDetune = getTargetTrackId() ? deps.getSynthParamsForTrack(getTargetTrackId()!).detune : 0;
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, audioEngine.context.currentTime, 0.003);
                }
                return;
            }

            const bendCents = (bendValue / 8192) * STANDARD_BEND_RANGE_CENTS;
            const baseDetune = getTargetTrackId() ? deps.getSynthParamsForTrack(getTargetTrackId()!).detune : 0;
            const now = audioEngine.context.currentTime;
            for (const noteData of activeNotes.values()) {
                if (noteData.osc) {
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, now, 0.003);
                }
            }
        }
);

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
