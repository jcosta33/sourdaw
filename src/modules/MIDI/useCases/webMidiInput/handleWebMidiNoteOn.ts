import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { applyVelocityCurve, createGrandBouleStore } from '#/modules/GrandBoule/stores';

import { createWebMidiNoteKey, type ActiveNoteData } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { handleWebMidiNoteOff } from './handleWebMidiNoteOff';
import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveDeviceNode } from './resolveDeviceNode';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime } from './resolveInputEventTime';
import { resolveInstrumentTrack } from './resolveInstrumentTrack';

export const handleWebMidiNoteOn = inject({
    ...midiMessageHandlerDependencies,
    handleWebMidiNoteOff,
})(
    ({ handleWebMidiNoteOff, ...deps }) =>
        async function handleWebMidiNoteOn(
            channel: number,
            note: number,
            velocity: number,
            timeStamp?: number
        ): Promise<void> {
            if (velocity === 0) {
                await handleWebMidiNoteOff(channel, note, 0, timeStamp);
                return;
            }

            const noteKey = createWebMidiNoteKey(channel, note);
            const mpeEnabled = getMpeEnabled();
            const channelNoteKey = mpeEnabled && channel >= 1 ? channelToNote.get(channel) : undefined;
            const noteToRelease =
                activeNotes.get(noteKey) ??
                (channelNoteKey === undefined ? undefined : activeNotes.get(channelNoteKey));
            if (noteToRelease) {
                await handleWebMidiNoteOff(noteToRelease.channel, noteToRelease.note, 0, timeStamp);
            } else if (channelNoteKey !== undefined) {
                channelToNote.delete(channel);
            }

            deps.stepRecordNoteOn(note, velocity);

            const targetTrackId = getTargetTrackId();
            if (!targetTrackId) {
                logger.warn('[MIDI] No target track set — select a MIDI track first');
                return;
            }

            const transport = deps.getTransportStoreValue();
            const engine = audioEngine;
            // When the key was struck, not when this handler got its turn on
            // the main thread (audit MD-1). Everything downstream — the voice
            // dispatch frame and the recorded note length — is measured from
            // this instant instead of the clock reading at handler-run time.
            const eventTime = resolveInputEventTime({ timeStamp });
            const dispatchFrame = resolveInputDispatchFrame({ eventTime });
            const dispatchTime = dispatchFrame / engine.context.sampleRate;
            const noteInstanceId = `${targetTrackId}:${channel}:${note}:${Math.round(eventTime * engine.context.sampleRate)}`;

            const noteData: ActiveNoteData = {
                startTime: eventTime,
                startBeat: transport ? deps.playheadPositionRef.current : 0,
                channel,
                note,
                velocity,
                trackId: targetTrackId,
                instrumentTrackId: targetTrackId,
                noteInstanceId,
            };
            activeNotes.set(noteKey, noteData);

            if (mpeEnabled && channel >= 1) {
                channelToNote.set(channel, noteKey);
            }

            const trackState = deps.getTrackStoreState();
            const resolvedInstrument = resolveInstrumentTrack(trackState, targetTrackId);
            const instrumentTrack = resolvedInstrument?.instrumentTrack;
            const instrumentTrackId = instrumentTrack?.id ?? targetTrackId;
            const toasterChildPad = resolvedInstrument?.toasterChildPad ?? null;

            noteData.instrumentTrackId = instrumentTrackId;

            const strip = engine.ensureTrackStrip(instrumentTrackId);

            const yeastDevice = instrumentTrack?.devices.find((device) => device.type === 'yeast');
            if (yeastDevice) {
                const sampleTime = dispatchFrame;
                let processedEvents;
                try {
                    processedEvents = await deps.processRealtimeMidiInput({
                        context: engine.context,
                        rackId: yeastDevice.id,
                        routeId: instrumentTrackId,
                        trackId: instrumentTrackId,
                        note,
                        velocity,
                        channel,
                        isNoteOn: true,
                        sampleTime,
                        sampleRate: engine.context.sampleRate,
                        noteInstanceId,
                    });
                } catch (error: unknown) {
                    // The note was registered before this awaited step; un-register it so a
                    // rejected note-on leaves no phantom active note behind.
                    activeNotes.delete(noteKey);
                    if (channelToNote.get(channel) === noteKey) {
                        channelToNote.delete(channel);
                    }
                    throw error;
                }
                const earliestDispatchFrame = Math.round(engine.context.currentTime * engine.context.sampleRate);
                for (const event of processedEvents) {
                    const eventSampleFrame = Math.max(earliestDispatchFrame, Math.round(event.timeSamples));
                    if (event.kind.type === 'noteOn') {
                        const eventNote = event.kind.note;
                        const eventVelocity = event.kind.velocity;
                        const fermenterDevice = instrumentTrack?.devices.find((device) => device.type === 'fermenter');
                        if (fermenterDevice) {
                            const deviceNode = resolveDeviceNode(strip, { type: 'fermenter' });
                            deviceNode?.fermenterControls?.noteOn(eventNote, eventVelocity, eventSampleFrame, channel);
                            continue;
                        }
                        const grandBouleDevice = instrumentTrack?.devices.find(
                            (device) => device.type === 'grand-boule'
                        );
                        if (grandBouleDevice) {
                            const deviceNode = resolveDeviceNode(strip, { type: 'grand-boule' });
                            deviceNode?.grandBouleControls?.noteOn(
                                eventNote,
                                eventVelocity / 127,
                                eventSampleFrame,
                                channel
                            );
                            void deps.eventBus.emit('midi.noteOn', {
                                deviceId: grandBouleDevice.id,
                                midiNote: eventNote,
                                velocity: eventVelocity / 127,
                            });
                            continue;
                        }
                        const levainDevice = instrumentTrack?.devices.find((device) => device.type === 'levain');
                        if (levainDevice) {
                            const deviceNode = resolveDeviceNode(strip, { type: 'levain' });
                            deviceNode?.levainControls?.noteOn(eventNote, eventVelocity, eventSampleFrame, channel);
                            continue;
                        }
                        const synthParams = deps.getSynthParamsForTrack(instrumentTrackId);
                        deps.scheduleNote(
                            engine.context,
                            strip.gainNode,
                            eventNote,
                            eventSampleFrame / engine.context.sampleRate,
                            0.5,
                            eventVelocity,
                            synthParams
                        );
                    } else if (event.kind.type === 'noteOff') {
                        const eventNote = event.kind.note;
                        const fermenterDevice = instrumentTrack?.devices.find((device) => device.type === 'fermenter');
                        if (fermenterDevice) {
                            const deviceNode = resolveDeviceNode(strip, { type: 'fermenter' });
                            deviceNode?.fermenterControls?.noteOff(eventNote, eventSampleFrame, channel);
                            continue;
                        }
                        const grandBouleDevice = instrumentTrack?.devices.find(
                            (device) => device.type === 'grand-boule'
                        );
                        if (grandBouleDevice) {
                            const deviceNode = resolveDeviceNode(strip, { type: 'grand-boule' });
                            deviceNode?.grandBouleControls?.noteOff(eventNote, eventSampleFrame, undefined, channel);
                            void deps.eventBus.emit('midi.noteOff', {
                                deviceId: grandBouleDevice.id,
                                midiNote: eventNote,
                            });
                            continue;
                        }
                        const levainDevice = instrumentTrack?.devices.find((device) => device.type === 'levain');
                        if (levainDevice) {
                            const deviceNode = resolveDeviceNode(strip, { type: 'levain' });
                            deviceNode?.levainControls?.noteOff(eventNote, eventSampleFrame, channel);
                            continue;
                        }
                    }
                }
                return;
            }

            const fermenterDevice = instrumentTrack?.devices.find((device) => device.type === 'fermenter');
            if (fermenterDevice) {
                const deviceNode = resolveDeviceNode(strip, { deviceId: fermenterDevice.id, type: 'fermenter' });
                if (deviceNode?.fermenterControls?.ready) {
                    deviceNode.fermenterControls.noteOn(note, velocity, dispatchFrame, channel);
                    noteData.fermenterDeviceId = fermenterDevice.id;
                }
                return;
            }

            const toasterDevice = instrumentTrack?.devices.find((device) => device.type === 'toaster');
            if (toasterDevice) {
                const deviceNode = resolveDeviceNode(strip, { deviceId: toasterDevice.id, type: 'toaster' });
                if (deviceNode?.toasterControls) {
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
                        deviceNode.toasterControls.noteOn(pad, velocity, pitchNote, dispatchFrame);
                        noteData.toasterRoute = { deviceId: toasterDevice.id, pad };
                    }
                }
                return;
            }

            const grandBouleDevice = instrumentTrack?.devices.find((device) => device.type === 'grand-boule');
            if (grandBouleDevice) {
                const deviceNode = resolveDeviceNode(strip, { deviceId: grandBouleDevice.id, type: 'grand-boule' });
                if (deviceNode?.grandBouleControls?.ready) {
                    const grandBouleStore = createGrandBouleStore(grandBouleDevice.id);
                    const calibration = grandBouleStore.value?.midiCalibration;
                    const finalVelocity = calibration ? applyVelocityCurve(velocity, calibration) : velocity / 127;
                    deviceNode.grandBouleControls.noteOn(note, finalVelocity, dispatchFrame, channel);
                    noteData.grandBouleDeviceId = grandBouleDevice.id;
                    void deps.eventBus.emit('midi.noteOn', {
                        deviceId: grandBouleDevice.id,
                        midiNote: note,
                        velocity: finalVelocity,
                    });
                }
                return;
            }

            const levainDevice = instrumentTrack?.devices.find((device) => device.type === 'levain');
            if (levainDevice) {
                const deviceNode = resolveDeviceNode(strip, { deviceId: levainDevice.id, type: 'levain' });
                if (deviceNode?.levainControls?.ready) {
                    deviceNode.levainControls.noteOn(note, velocity, dispatchFrame, channel);
                    noteData.levainDeviceId = levainDevice.id;
                    return;
                }
                return;
            }

            let oscillator: (OscillatorNode & { _env?: GainNode }) | null = null;
            const synthDevice = instrumentTrack?.devices.find(
                (device) =>
                    device.type === 'builtin-drum-kit' ||
                    device.type.startsWith('builtin-drum-machine') ||
                    device.type.startsWith('builtin-synth')
            );

            if (synthDevice?.type === 'builtin-drum-kit' || synthDevice?.type.startsWith('builtin-drum-machine')) {
                const kitIndex = synthDevice.parameterValues.kit ?? 0;
                const kitDefinition = deps.getDrumKitDefByIndex(kitIndex);
                if (kitDefinition) {
                    deps.scheduleDrumKitNote(
                        engine.context,
                        strip.gainNode,
                        kitDefinition,
                        note,
                        dispatchTime,
                        velocity
                    );
                } else {
                    const kit = deps.getDrumKitByIndex(kitIndex);
                    if (kit) {
                        oscillator = deps.scheduleKitNote(
                            engine.context,
                            strip.gainNode,
                            kit,
                            note,
                            dispatchTime,
                            60,
                            velocity
                        );
                    }
                }
            } else {
                const synthParams = deps.getSynthParamsForTrack(targetTrackId);
                oscillator = deps.scheduleNote(
                    engine.context,
                    strip.gainNode,
                    note,
                    dispatchTime,
                    60,
                    velocity,
                    synthParams
                );
            }

            if (oscillator) {
                noteData.osc = oscillator;
            }
        }
);
