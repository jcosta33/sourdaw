import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { audioEngine, startFaustNote } from '#/modules/AudioEngine/useCases';
import { applyVelocityCurve, createGrandBouleStore } from '#/modules/GrandBoule/stores';
import { isBypassedNoteReceiver, resolveDrumKitBy } from '#/utils/deviceTypeMatching';

import { createWebMidiNoteKey, type ActiveNoteData } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { memberExpressionGeneration } from '../../repositories/webMidi/memberExpressionGeneration';
import { memberExpressionState } from '../../repositories/webMidi/memberExpressionState';
import { pendingMemberAdmission } from '../../repositories/webMidi/pendingMemberAdmission';
import { pendingYeastRelease } from '../../repositories/webMidi/pendingYeastRelease';
import { type RealtimeMidiEvent } from '../../repositories/webMidi/realtimeMidiProcessorState';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { captureEventBeatAt } from './captureEventBeat';
import { handleWebMidiNoteOff } from './handleWebMidiNoteOff';
import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { recordHeldNoteExpression } from './recordHeldNoteExpression';
import { resolveBendRangeSemitones } from './resolveBendRangeSemitones';
import { resolveDeviceNode } from './resolveDeviceNode';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime, type CapturedInputEventTime } from './resolveInputEventTime';
import { resolveInstrumentTrack } from './resolveInstrumentTrack';
import { resolveLiveInputNoteReceiver } from './resolveLiveInputNoteReceiver';
import { resolveNativeNoteSink } from './resolveNativeNoteSink';
import { voiceYeastNoteOn } from './voiceYeastNoteOn';

/**
 * Duration sentinel handed to `scheduleNote` when a live note must sustain
 * until its note-off arrives: 60 seconds is far longer than any held note, and
 * the note-off path tears the voice down regardless.
 */
const HOLD_UNTIL_NOTE_OFF_SECONDS = 60;

let nextNoteInstanceSerial = 0;

export const handleWebMidiNoteOn = inject({
    ...midiMessageHandlerDependencies,
    handleWebMidiNoteOff,
})(
    ({ handleWebMidiNoteOff, ...deps }) =>
        async function handleWebMidiNoteOn(
            channel: number,
            note: number,
            velocity: number,
            timeStamp?: number | CapturedInputEventTime
        ): Promise<void> {
            if (velocity === 0) {
                await handleWebMidiNoteOff(channel, note, 0, timeStamp);
                return;
            }

            const generation = memberExpressionGeneration.current;
            const eventTime = resolveInputEventTime({ timeStamp });
            let admittedBeat: number;
            if (typeof timeStamp === 'object' && timeStamp !== null && Number.isFinite(timeStamp.recordingBeat)) {
                admittedBeat = timeStamp.recordingBeat!;
            } else {
                // No dispatcher-captured beat: derive it from this event's own
                // instant anyway (#4875).
                admittedBeat = captureEventBeatAt({ audioTime: eventTime });
            }

            const noteKey = createWebMidiNoteKey(channel, note);
            const mpeEnabled = getMpeEnabled();
            const memberExpression = mpeEnabled && channel >= 1 ? memberExpressionState.get(channel) : undefined;
            let initialBendRangeSemitones: number | undefined;
            if (memberExpression?.pitchBend !== undefined) {
                initialBendRangeSemitones = resolveBendRangeSemitones({ channel, mpeEnabled });
            }
            const memberAdmission = mpeEnabled && channel >= 1 ? pendingMemberAdmission.begin(channel) : undefined;
            const channelNoteKey = mpeEnabled && channel >= 1 ? channelToNote.get(channel) : undefined;
            const noteToRelease =
                activeNotes.get(noteKey) ??
                (channelNoteKey === undefined ? undefined : activeNotes.get(channelNoteKey));
            let admittedChanges: ReturnType<typeof pendingMemberAdmission.take>;
            try {
                if (noteToRelease) {
                    await handleWebMidiNoteOff(noteToRelease.channel, noteToRelease.note, 0, timeStamp);
                } else if (channelNoteKey !== undefined) {
                    channelToNote.delete(channel);
                }
            } finally {
                admittedChanges = pendingMemberAdmission.take(memberAdmission);
            }
            if (generation !== memberExpressionGeneration.current) {
                return;
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
            const dispatchFrame = resolveInputDispatchFrame({ eventTime });
            const dispatchTime = dispatchFrame / engine.context.sampleRate;
            const noteInstanceId = `${targetTrackId}:${channel}:${note}:${Math.round(eventTime * engine.context.sampleRate)}:${++nextNoteInstanceSerial}`;
            const pitchBendRangeSemitones = initialBendRangeSemitones;

            const noteData: ActiveNoteData = {
                startTime: eventTime,
                startBeat: transport ? admittedBeat : 0,
                channel,
                note,
                velocity,
                trackId: targetTrackId,
                instrumentTrackId: targetTrackId,
                noteInstanceId,
                pressure: memberExpression?.pressure,
                slide: memberExpression?.slide,
                pitchBend: memberExpression?.pitchBend,
                pitchBendRangeSemitones,
            };
            for (const change of admittedChanges) {
                recordHeldNoteExpression(noteData, change);
                noteData[change.dimension] = change.value;
                if (change.dimension === 'pitchBend') {
                    noteData.pitchBendRangeSemitones = change.bendRangeSemitones;
                }
            }
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
            if (instrumentTrack && yeastDevice) {
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
                        onDrainedEvents: (drainedEvents) => {
                            // A reset ended the input session that owns this
                            // note's voices; the pump retires with it (#4870).
                            if (generation !== memberExpressionGeneration.current) {
                                return false;
                            }
                            voiceYeastEvents(drainedEvents);
                            return undefined;
                        },
                    });
                } catch (error: unknown) {
                    // The note was registered before this awaited step; un-register it so a
                    // rejected note-on leaves no phantom active note behind.
                    // After a reset, the same key can belong to a new note.
                    if (activeNotes.get(noteKey) === noteData) {
                        activeNotes.delete(noteKey);
                        if (channelToNote.get(channel) === noteKey) {
                            channelToNote.delete(channel);
                        }
                    }
                    throw error;
                }
                // Reset released the registered note while the worker was
                // processing. Never voice its late result in the new session.
                if (generation !== memberExpressionGeneration.current || activeNotes.get(noteKey) !== noteData) {
                    if (activeNotes.get(noteKey) === noteData) {
                        activeNotes.delete(noteKey);
                        if (channelToNote.get(channel) === noteKey) {
                            channelToNote.delete(channel);
                        }
                    }
                    return;
                }
                const earliestDispatchFrame = Math.round(engine.context.currentTime * engine.context.sampleRate);
                const startCapturedVoice = (
                    pitch: number,
                    voiceChannel: number,
                    generatedId: string | undefined,
                    sampleFrame: number,
                    start: () => void,
                    release: (sampleFrame?: number, releaseVelocity?: number) => void
                ): void => {
                    pendingYeastRelease.retire(
                        `${instrumentTrackId}:${yeastDevice.id}`,
                        voiceChannel,
                        pitch,
                        sampleFrame
                    );
                    if (generatedId === undefined) {
                        noteData.yeastVoiceReleases?.get(pitch)?.(sampleFrame, 0);
                        start();
                        (noteData.yeastVoiceReleases ??= new Map()).set(pitch, release);
                    } else {
                        start();
                        // The voice registers in the shared route-keyed
                        // registry at start, not in this note's map (#4870):
                        // the drain that supersedes this session's pump must
                        // be able to release a voice this session started.
                        pendingYeastRelease.registerVoice(
                            `${instrumentTrackId}:${yeastDevice.id}`,
                            instrumentTrackId,
                            generatedId,
                            pitch,
                            voiceChannel,
                            release
                        );
                    }
                };
                // Generated notes reach the receiving instrument the key itself
                // would reach without Yeast.
                const yeastReceiver = resolveLiveInputNoteReceiver(instrumentTrack.devices, toasterChildPad !== null);
                // One voicing path for the ingress batch and for every drained
                // idle-pump batch, so generated voices are owned identically
                // however they arrive (#4870).
                const voiceYeastEvents = (events: readonly RealtimeMidiEvent[]): void => {
                    for (const event of events) {
                        const eventSampleFrame = Math.max(earliestDispatchFrame, Math.round(event.timeSamples));
                        if (event.kind.type === 'noteOn') {
                            const eventNote = event.kind.note;
                            const eventChannel = event.kind.channel;
                            voiceYeastNoteOn({
                                note: eventNote,
                                velocity: event.kind.velocity,
                                channel: eventChannel,
                                sampleFrame: eventSampleFrame,
                                // A generated note carries its own held lifetime;
                                // only a source event without one falls back to a
                                // fixed length (#4870).
                                durationSamples: event.durationSamples,
                                receiver: yeastReceiver,
                                instrumentTrackId,
                                trackDevices: instrumentTrack.devices,
                                toasterChildPad,
                                strip,
                                engine,
                                context: engine.context,
                                resolveDestination: () => strip.gainNode,
                                deps,
                                capture: (start, release) =>
                                    startCapturedVoice(
                                        eventNote,
                                        eventChannel,
                                        event.noteInstanceId,
                                        eventSampleFrame,
                                        start,
                                        release
                                    ),
                            });
                        } else if (event.kind.type === 'noteOff') {
                            const eventNote = event.kind.note;
                            if (
                                pendingYeastRelease.releaseEvent({
                                    routeId: `${instrumentTrackId}:${yeastDevice.id}`,
                                    trackId: event.trackId,
                                    noteInstanceId: event.noteInstanceId,
                                    channel: event.kind.channel,
                                    pitch: eventNote,
                                    sampleFrame: eventSampleFrame,
                                })
                            ) {
                                continue;
                            }
                            if (event.trackId !== undefined && event.trackId !== instrumentTrackId) {
                                continue;
                            }
                            if (event.noteInstanceId !== undefined) {
                                // Instance-keyed voices release through the
                                // shared registry's releaseEvent above, from
                                // any session's drain (#4870). A note-off
                                // that did not resolve there is a repeat and
                                // must not fall through to the source-pitch
                                // release below.
                                continue;
                            }
                            if (event.kind.channel !== channel) {
                                continue;
                            }
                            noteData.yeastVoiceReleases?.get(eventNote)?.(eventSampleFrame);
                            noteData.yeastVoiceReleases?.delete(eventNote);
                        }
                    }
                };
                voiceYeastEvents(processedEvents);
                return;
            }

            // The native body precedes every built-in branch below: a device the
            // engine is carrying is silent on Web Audio, so a carried device must
            // never fall into a built-in branch that would voice it there instead.
            const nativeSink = instrumentTrack ? resolveNativeNoteSink(instrumentTrack, deps) : null;
            if (nativeSink) {
                noteData.nativeDeviceId = nativeSink.id;
                void deps.sendNativeLiveMidiNote({
                    trackId: instrumentTrackId,
                    deviceId: nativeSink.id,
                    note,
                    velocity,
                    channel,
                    isNoteOn: true,
                });
                return;
            }

            // The key reaches the track's receiving instrument, the one sequenced
            // playback and the export voice; each branch below only delivers to it.
            const receiver = resolveLiveInputNoteReceiver(instrumentTrack?.devices ?? [], toasterChildPad !== null);
            const receivingDevice = receiver?.device;

            if (isBypassedNoteReceiver(receiver)) {
                return;
            }

            if (receivingDevice?.type === 'fermenter') {
                const fermenterDevice = receivingDevice;
                const deviceNode = resolveDeviceNode(strip, { deviceId: fermenterDevice.id, type: 'fermenter' });
                if (deviceNode?.fermenterControls?.ready) {
                    deviceNode.fermenterControls.noteOn(note, velocity, dispatchFrame, channel);
                    noteData.fermenterDeviceId = fermenterDevice.id;
                }
                return;
            }

            if (receiver?.kind === 'toaster') {
                const toasterDevice = receiver.device;
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

            if (receivingDevice?.type === 'grand-boule') {
                const grandBouleDevice = receivingDevice;
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

            if (receivingDevice?.type === 'levain') {
                const levainDevice = receivingDevice;
                const deviceNode = resolveDeviceNode(strip, { deviceId: levainDevice.id, type: 'levain' });
                if (deviceNode?.levainControls?.ready) {
                    deviceNode.levainControls.noteOn(note, velocity, dispatchFrame, channel);
                    noteData.levainDeviceId = levainDevice.id;
                    return;
                }
                return;
            }

            if (receivingDevice?.type === 'builtin-crumbs') {
                const crumbsDevice = receivingDevice;
                const deviceNode = resolveDeviceNode(strip, { deviceId: crumbsDevice.id, type: 'builtin-crumbs' });
                if (deviceNode?.crumbsControls?.ready) {
                    deviceNode.crumbsControls.noteOn(note, velocity, dispatchFrame, channel);
                    noteData.crumbsDeviceId = crumbsDevice.id;
                }
                return;
            }

            let oscillator: (OscillatorNode & { _env?: GainNode }) | null = null;
            if (receiver?.kind === 'drum') {
                // The same drum device and kit index sequenced playback, audition and
                // export resolve; only the kit lookups differ.
                const trackDevices = instrumentTrack?.devices ?? [];
                const kitDefinition = resolveDrumKitBy(trackDevices, deps.getDrumKitDefByIndex);
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
                    const kit = resolveDrumKitBy(trackDevices, deps.getDrumKitByIndex);
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

                if (oscillator) {
                    noteData.osc = oscillator;
                }
                return;
            }

            // A Faust pro-synth instrument (electric piano, FM synth, supersaw, …) voices
            // its notes through the same live control path the piano-roll audition
            // uses: `startFaustNote` writes freq/gain/gate on the device and hands
            // back the release that gates it off. Without this branch the note fell
            // through to the default-parameter builtin synth below, so monitoring
            // played a different instrument from playback and the offline render
            // (issue #3726).
            if (receiver?.kind === 'faust') {
                const faustDevice = receiver.device;
                noteData.faustRelease = startFaustNote(instrumentTrackId, faustDevice.id, note, velocity, dispatchTime);
                return;
            }

            // The built-in synth, set from the track's synth device when it is the
            // receiver and from its defaults when the chain holds no instrument
            // live input can voice.
            const synthParams = deps.getSynthParamsForTrack(targetTrackId);
            oscillator = deps.scheduleNote(
                engine.context,
                strip.gainNode,
                note,
                dispatchTime,
                HOLD_UNTIL_NOTE_OFF_SECONDS,
                velocity,
                synthParams
            );

            if (oscillator) {
                noteData.osc = oscillator;
            }
        }
);
