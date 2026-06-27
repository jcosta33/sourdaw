/**
 * MIDI message handlers: noteOn, noteOff, CC, channel pressure, pitch bend.
 * Handles both live monitoring (oscillator playback) and recording (note creation).
 *
 * Handlers share module-local MIDI routing state. Some exports use `inject({ logger })` or
 * `inject(midiMessageHandlerDependencies)` for test overrides and lazy resolution.
 */
import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { applyVelocityCurve, createGrandBouleStore } from '#/modules/GrandBoule/stores';
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
import {
    getDrumKitDefByIndex,
    getSynthParamsFromDevices,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNote,
} from '#/modules/Synth/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';
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

import { routeYeastNoteOffToInstrument } from './routeYeastNoteOff';
import { activeNotes, channelToNote, getMpeEnabled, getTargetTrackId } from './state';
import { WebMidiEventBus } from './webMidiEventBus';

function getTrackStoreState(): TrackStoreState | null {
    return trackStore.value;
}

function getTransportStoreValue() {
    return transportStore.value;
}

function getSynthParamsForTrack(trackId: string): ReturnType<typeof getSynthParamsFromDevices> {
    const track = trackStore.value?.tracks.find((t) => t.id === trackId);
    return getSynthParamsFromDevices(track?.devices ?? []);
}

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
    eventBus: WebMidiEventBus,
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

        const track = trackState.tracks.find((time) => time.id === trackId);
        if (!track) {
            return null;
        }

        const midiClips = track.clips.filter((context) => context.type === 'midi');
        if (midiClips.length === 0) {
            return null;
        }

        if (transport.isRecording && transport.overdubEnabled) {
            const ph = deps.playheadPositionRef.current;
            const intersecting = midiClips.find((context) => ph >= context.startBeat && ph <= context.endBeat);
            if (intersecting) {
                return intersecting.id;
            }

            if (transport.isLooping && ph >= transport.loopStart && ph <= transport.loopEnd) {
                const loopClip = midiClips.find(
                    (context) => context.startBeat >= transport.loopStart && context.endBeat <= transport.loopEnd
                );
                if (loopClip) {
                    return loopClip.id;
                }
            }
        }

        return midiClips[midiClips.length - 1]!.id;
    }

    return function handleNoteOff(channel: number, note: number, releaseVelocity: number = 0): void {
        deps.stepRecordNoteOff(note);
        const noteData = activeNotes.get(note);
        if (!noteData) {
            return;
        }

        activeNotes.delete(note);

        if (getMpeEnabled()) {
            channelToNote.delete(noteData.channel);
        }

        // Route the Note Off through the Yeast rack so processors (Transposer,
        // ChordGenerator, Harmonizer, …) reverse the note mapping they applied on
        // Note On. Without this, generated/transposed notes never receive a Note
        // Off and hang (CRITICAL #62). The raw-key device routing below is gated on
        // device-id fields that the Yeast Note On path never sets, so it stays a
        // no-op for Yeast tracks; the recording path at the bottom still runs.
        if (getTargetTrackId()) {
            const trackState = deps.getTrackStoreState();
            const targetTrack = trackState?.tracks.find((time) => time.id === getTargetTrackId());

            let instrumentTrack = targetTrack;
            if (targetTrack && targetTrack.parentId && trackState) {
                const parent = trackState.tracks.find((time) => time.id === targetTrack.parentId);
                if (parent?.devices.some((data) => data.type === 'toaster')) {
                    instrumentTrack = parent;
                }
            }

            if (instrumentTrack?.devices.some((data) => data.type === 'yeast')) {
                const ctx = audioEngine.context;
                const sampleTime = Math.round(ctx.currentTime * ctx.sampleRate);
                const processedEvents = deps.processRealtimeMidiInput(
                    note,
                    0,
                    channel,
                    false,
                    sampleTime,
                    ctx.sampleRate
                );
                const strip = audioEngine.getTrackStrip(instrumentTrack.id);
                const emitGrandBouleOff = (deviceId: string, midiNote: number): void => {
                    void deps.eventBus.emit('midi.noteOff', { deviceId, midiNote, releaseVelocity });
                };
                for (const evt of processedEvents) {
                    if (evt.kind.type !== 'noteOff') {
                        continue;
                    }
                    routeYeastNoteOffToInstrument(
                        instrumentTrack,
                        strip,
                        evt.kind.note,
                        releaseVelocity,
                        emitGrandBouleOff
                    );
                }
            }
        }

        if (noteData.fermenterDeviceId && getTargetTrackId()) {
            const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
            const dn = strip?.deviceNodes.find((data) => data.deviceId === noteData.fermenterDeviceId);
            if (dn?.fermenterControls) {
                dn.fermenterControls.noteOff(note);
            }
        }

        if (noteData.toasterDeviceId && getTargetTrackId()) {
            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((time) => time.id === getTargetTrackId());
            let instrumentTrackId = getTargetTrackId()!;
            let toasterChildPad: number | null = null;

            if (track && track.devices.length === 0 && track.parentId && trackState) {
                // Single pass: find parent + child pad index, instead of
                // `find()` + `filter()` + `findIndex()` (§80.4).
                let parent: typeof track | undefined;
                let padIdx = 0;
                for (const time of trackState.tracks) {
                    if (time.id === track.parentId) {
                        parent = time;
                    } else if (time.parentId === track.parentId) {
                        if (time.id === track.id) {
                            toasterChildPad = padIdx;
                        }
                        padIdx++;
                    }
                }
                if (parent?.devices.some((data) => data.type === 'toaster')) {
                    instrumentTrackId = parent.id;
                } else {
                    toasterChildPad = null;
                }
            }

            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const dn = strip?.deviceNodes.find((data) => data.deviceId === noteData.toasterDeviceId);
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
            const dn = strip?.deviceNodes.find((data) => data.deviceId === noteData.grandBouleDeviceId);
            if (dn?.grandBouleControls) {
                dn.grandBouleControls.noteOff(note, undefined, releaseVelocity);
            }
            void deps.eventBus.emit('midi.noteOff', {
                deviceId: noteData.grandBouleDeviceId,
                midiNote: note,
                releaseVelocity,
            });
        }

        if (noteData.levainDeviceId && getTargetTrackId()) {
            const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
            const levainId = noteData.levainDeviceId;
            const dn = strip?.deviceNodes.find((data) => data.deviceId === levainId);
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
        const track = trackState?.tracks.find((time) => time.id === getTargetTrackId());
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
                // Running-status Note Off (Note On, velocity 0) carries no
                // release-velocity byte; release dynamic defaults to 0.
                handleNoteOff(channel, note, 0);
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
            const track = trackState?.tracks.find((time) => time.id === getTargetTrackId());

            let instrumentTrackId = getTargetTrackId()!;
            let instrumentTrack = track;
            let toasterChildPad: number | null = null;

            if (track && track.parentId && trackState) {
                // Single pass instead of find() + filter() + findIndex() (§80.4).
                let parent: typeof track | undefined;
                let padIdx = 0;
                for (const time of trackState.tracks) {
                    if (time.id === track.parentId) {
                        parent = time;
                    } else if (time.parentId === track.parentId) {
                        if (time.id === track.id) {
                            toasterChildPad = padIdx;
                        }
                        padIdx++;
                    }
                }
                if (parent?.devices.some((data) => data.type === 'toaster')) {
                    instrumentTrackId = parent.id;
                    instrumentTrack = parent;
                } else {
                    toasterChildPad = null;
                }
            }

            const strip = engine.ensureTrackStrip(instrumentTrackId);

            const hasYeast = instrumentTrack?.devices.some((data) => data.type === 'yeast');
            if (hasYeast) {
                const sampleTime = Math.round(now * engine.context.sampleRate);
                const processedEvents = deps.processRealtimeMidiInput(
                    note,
                    velocity,
                    channel,
                    true,
                    sampleTime,
                    engine.context.sampleRate
                );
                for (const evt of processedEvents) {
                    if (evt.kind.type === 'noteOn') {
                        const evtNote = evt.kind.note;
                        const evtVel = evt.kind.velocity;
                        const fDev = instrumentTrack?.devices.find((data) => data.type === 'fermenter');
                        if (fDev) {
                            const dn = strip.deviceNodes.find((data) => data.type === 'fermenter');
                            dn?.fermenterControls?.noteOn(evtNote, evtVel);
                            continue;
                        }
                        const gbDev = instrumentTrack?.devices.find((data) => data.type === 'grand-boule');
                        if (gbDev) {
                            const dn = strip.deviceNodes.find((data) => data.type === 'grand-boule');
                            dn?.grandBouleControls?.noteOn(evtNote, evtVel / 127);
                            void deps.eventBus.emit('midi.noteOn', {
                                deviceId: gbDev.id,
                                midiNote: evtNote,
                                velocity: evtVel / 127,
                            });
                            continue;
                        }
                        const lDev = instrumentTrack?.devices.find((data) => data.type === 'levain');
                        if (lDev) {
                            const dn = strip.deviceNodes.find((data) => data.type === 'levain');
                            dn?.levainControls?.noteOn(evtNote, evtVel);
                            continue;
                        }
                        const sp = deps.getSynthParamsForTrack(instrumentTrackId);
                        if (sp) {
                            deps.scheduleNote(engine.context, strip.gainNode, evtNote, now, 0.5, evtVel, sp);
                        }
                    } else if (evt.kind.type === 'noteOff') {
                        const evtNote = evt.kind.note;
                        const fDev = instrumentTrack?.devices.find((data) => data.type === 'fermenter');
                        if (fDev) {
                            const dn = strip.deviceNodes.find((data) => data.type === 'fermenter');
                            dn?.fermenterControls?.noteOff(evtNote);
                            continue;
                        }
                        const gbDev2 = instrumentTrack?.devices.find((data) => data.type === 'grand-boule');
                        if (gbDev2) {
                            const dn = strip.deviceNodes.find((data) => data.type === 'grand-boule');
                            dn?.grandBouleControls?.noteOff(evtNote);
                            void deps.eventBus.emit('midi.noteOff', { deviceId: gbDev2.id, midiNote: evtNote });
                            continue;
                        }
                        const lDev = instrumentTrack?.devices.find((data) => data.type === 'levain');
                        if (lDev) {
                            const dn = strip.deviceNodes.find((data) => data.type === 'levain');
                            dn?.levainControls?.noteOff(evtNote);
                            continue;
                        }
                    }
                }
                return;
            }

            const fermenterDev = instrumentTrack?.devices.find((data) => data.type === 'fermenter');
            if (fermenterDev) {
                const dn = strip.deviceNodes.find(
                    (data) => data.deviceId === fermenterDev.id || data.type === 'fermenter'
                );
                if (dn?.fermenterControls?.ready) {
                    dn.fermenterControls.noteOn(note, velocity);
                    noteData.fermenterDeviceId = fermenterDev.id;
                }
                return;
            }

            const toasterDev = instrumentTrack?.devices.find((data) => data.type === 'toaster');
            if (toasterDev) {
                const dn = strip.deviceNodes.find((data) => data.deviceId === toasterDev.id || data.type === 'toaster');
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

            const grandBouleDev = instrumentTrack?.devices.find((data) => data.type === 'grand-boule');
            if (grandBouleDev) {
                const dn = strip.deviceNodes.find(
                    (data) => data.deviceId === grandBouleDev.id || data.type === 'grand-boule'
                );
                if (dn?.grandBouleControls?.ready) {
                    const gbStore = createGrandBouleStore(grandBouleDev.id);
                    const calibration = gbStore.value?.midiCalibration;
                    const finalVelocity = calibration ? applyVelocityCurve(velocity, calibration) : velocity / 127;
                    dn.grandBouleControls.noteOn(note, finalVelocity);
                    noteData.grandBouleDeviceId = grandBouleDev.id;
                    void deps.eventBus.emit('midi.noteOn', {
                        deviceId: grandBouleDev.id,
                        midiNote: note,
                        velocity: finalVelocity,
                    });
                }
                return;
            }

            const levainDev = instrumentTrack?.devices.find((data) => data.type === 'levain');
            if (levainDev) {
                const dn = strip.deviceNodes.find((data) => data.deviceId === levainDev.id || data.type === 'levain');
                if (dn?.levainControls?.ready) {
                    dn.levainControls.noteOn(note, velocity);
                    noteData.levainDeviceId = levainDev.id;
                    return;
                }
                return;
            }

            let osc: (OscillatorNode & { _env?: GainNode }) | null = null;
            const synthDevice = instrumentTrack?.devices.find(
                (data) =>
                    data.type === 'builtin-drum-kit' ||
                    data.type.startsWith('builtin-drum-machine') ||
                    data.type.startsWith('builtin-synth')
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
                );
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
            const track = trackState?.tracks.find((time) => time.id === getTargetTrackId());
            const grandBouleDevice = track?.devices.find((data) => data.type === 'grand-boule');
            if (grandBouleDevice) {
                const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
                const dn = strip?.deviceNodes.find(
                    (data) => data.deviceId === grandBouleDevice.id || data.type === 'grand-boule'
                );
                if (dn?.grandBouleControls?.ready) {
                    if (cc === 64) {
                        dn.grandBouleControls.setSustain(value / 127);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 64,
                            value: value / 127,
                        });
                    } else if (cc === 66) {
                        dn.grandBouleControls.setSostenuto(value >= 64);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 66,
                            value: value >= 64,
                        });
                    } else if (cc === 67) {
                        dn.grandBouleControls.setUnaCorda(value >= 64);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 67,
                            value: value >= 64,
                        });
                    }
                }
            }

            const levainDevice = track?.devices.find((data) => data.type === 'levain');
            if (levainDevice) {
                const strip = audioEngine.getTrackStrip(getTargetTrackId()!);
                const dn = strip?.deviceNodes.find(
                    (data) => data.deviceId === levainDevice.id || data.type === 'levain'
                );
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
            // data[2] is the raw release/note-off velocity (0..127); normalize to
            // 0..1 and thread it through so the release dynamic is preserved.
            handleNoteOff(channel, data[1]!, (data[2] ?? 0) / 127);
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
