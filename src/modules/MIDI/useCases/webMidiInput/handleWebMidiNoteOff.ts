import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { readBeatAtSamples } from '#/modules/Transport/stores';
import { DEFAULT_NOTE_VELOCITY } from '#/utils/midiData';

import { createWebMidiNoteKey, type ActiveNoteData } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { memberExpressionGeneration } from '../../repositories/webMidi/memberExpressionGeneration';
import { pendingYeastRelease } from '../../repositories/webMidi/pendingYeastRelease';
import { type RealtimeMidiEvent } from '../../repositories/webMidi/realtimeMidiProcessorState';
import { releaseActiveToasterNote } from '../../repositories/webMidi/releaseActiveToasterNote';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { releaseKeyInRemovedYeastRack } from './releaseKeyInRemovedYeastRack';
import { resolveDeviceNode } from './resolveDeviceNode';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime, type CapturedInputEventTime } from './resolveInputEventTime';
import { resolveInstrumentTrack } from './resolveInstrumentTrack';
import { resolveLiveInputNoteReceiver } from './resolveLiveInputNoteReceiver';
import { resolveRecordingPlacement } from './resolveRecordingPlacement';
import { retireDrainOfRemovedYeast } from './retireDrainOfRemovedYeast';
import { voiceYeastNoteOn } from './voiceYeastNoteOn';
import { withRecordedNoteExpression } from './withRecordedNoteExpression';

/** Whether a key still held went through this Yeast on this instrument track. */
function isYeastRouteHeld(instrumentTrackId: string, yeastDeviceId: string): boolean {
    for (const held of activeNotes.values()) {
        if (held.instrumentTrackId === instrumentTrackId && held.yeastDeviceId === yeastDeviceId) {
            return true;
        }
    }
    return false;
}

/**
 * Release every voice a Yeast note-on started when the chain no longer holds
 * that Yeast (removed, or its track gone): no rack is left to send the
 * note-offs, so a held voice would otherwise sound until panic. Generated
 * voices release through the shared registry, which skips any already ended.
 *
 * A voice the Yeast generated is recorded on whichever key's session drained
 * it, not on the key it musically belongs to, and a key-up session records
 * its voices on no key at all. So once the last key that went through the
 * Yeast is up, every voice still registered on its route is released too;
 * while another such key is held, only this key's own voices are.
 */
function releaseVoicesWithoutYeast(
    noteData: ActiveNoteData,
    yeastDeviceId: string,
    sampleFrame: number,
    releaseVelocity: number
): void {
    const routeId = `${noteData.instrumentTrackId}:${yeastDeviceId}`;
    for (const voice of noteData.yeastGeneratedVoices ?? []) {
        pendingYeastRelease.releaseEvent({
            routeId,
            trackId: noteData.instrumentTrackId,
            noteInstanceId: voice.noteInstanceId,
            channel: voice.channel,
            pitch: voice.pitch,
            sampleFrame,
            releaseVelocity,
        });
    }
    for (const release of noteData.yeastVoiceReleases?.values() ?? []) {
        release(sampleFrame, releaseVelocity);
    }
    noteData.yeastVoiceReleases?.clear();
    if (!isYeastRouteHeld(noteData.instrumentTrackId, yeastDeviceId)) {
        pendingYeastRelease.releaseRoute(routeId, sampleFrame, releaseVelocity);
    }
}

export const handleWebMidiNoteOff = inject(midiMessageHandlerDependencies)((deps) => {
    return async function handleWebMidiNoteOff(
        channel: number,
        note: number,
        releaseVelocity: number = 0,
        timeStamp?: number | CapturedInputEventTime
    ): Promise<void> {
        // When the key was released, not when this handler got its turn. The
        // recorded note length is the difference between two of these, so both
        // ends have to be measured on the same footing (audit MD-1).
        const eventTime = resolveInputEventTime({ timeStamp });
        const dispatchFrame = resolveInputDispatchFrame({ eventTime });
        deps.stepRecordNoteOff(note);
        const noteKey = createWebMidiNoteKey(channel, note);
        const noteData = activeNotes.get(noteKey);
        if (!noteData) {
            return;
        }

        activeNotes.delete(noteKey);

        if (channelToNote.get(noteData.channel) === noteKey) {
            channelToNote.delete(noteData.channel);
        }

        const targetTrackId = noteData.trackId;
        const instrumentTrackId = noteData.instrumentTrackId;
        const instrumentTrackState = deps.getTrackStoreState();
        const instrumentTrack = instrumentTrackState?.tracks.find((candidate) => candidate.id === instrumentTrackId);

        // The release goes through the Yeast the note-on went through, never
        // through one the chain gained since.
        const yeastDeviceId = noteData.yeastDeviceId;
        const yeastDevice = instrumentTrack?.devices.find(
            (device) => yeastDeviceId !== undefined && device.id === yeastDeviceId && device.type === 'yeast'
        );
        if (yeastDeviceId !== undefined && yeastDevice === undefined) {
            // No key-up reaches the rack, so the note's idle pump is retired
            // here: a batch it still hands back voices nothing (#5222).
            noteData.yeastSessionEnded = true;
            releaseVoicesWithoutYeast(noteData, yeastDeviceId, dispatchFrame, releaseVelocity);
            // The rack the Yeast owns outlives it and still counts the key as
            // held; an undone removal would replay it (#5257).
            await releaseKeyInRemovedYeastRack({
                process: deps.processRealtimeMidiInput,
                context: audioEngine.context,
                yeastDeviceId,
                instrumentTrackId,
                note,
                channel,
                sampleFrame: dispatchFrame,
                noteInstanceId: noteData.noteInstanceId,
            });
        }
        if (instrumentTrack && yeastDevice) {
            const context = audioEngine.context;
            const sampleTime = dispatchFrame;
            const pendingRelease = pendingYeastRelease.begin(
                `${instrumentTrackId}:${yeastDevice.id}`,
                noteData.yeastVoiceReleases ?? new Map(),
                instrumentTrackId,
                noteData.channel
            );
            // A reset while the release is being processed ended the input
            // session that owns its voices; batches drained from before it
            // must not voice into the new one (#4870).
            const generation = memberExpressionGeneration.current;
            // A drained event clamps to the delivery-time frame, the same
            // clamp the ingress batch applies against its post-processing
            // read (#4870).
            const drainedEventSampleFrame = (event: RealtimeMidiEvent): number =>
                Math.max(Math.round(context.currentTime * context.sampleRate), Math.round(event.timeSamples));
            const startCapturedVoice = (
                pitch: number,
                voiceChannel: number,
                generatedId: string | undefined,
                sampleFrame: number,
                start: () => void,
                release: (sampleFrame?: number, releaseVelocity?: number) => void
            ): void => {
                pendingYeastRelease.retire(`${instrumentTrackId}:${yeastDevice.id}`, voiceChannel, pitch, sampleFrame);
                if (generatedId === undefined) {
                    noteData.yeastVoiceReleases?.get(pitch)?.(sampleFrame, 0);
                    start();
                    // The key is already up: the voice lives on this release
                    // session, where its source-pitch note-off, a route
                    // release and a reset can still reach it.
                    pendingYeastRelease.addSourceVoice(pendingRelease, pitch, voiceChannel, release);
                } else {
                    start();
                    // The voice registers in the shared route-keyed registry
                    // at start, not in this note's map (#4870): the drain
                    // that supersedes this session's pump must be able to
                    // release a voice this session started.
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
            // A generated note first emitted at the release block reaches its
            // block only through the idle pump; this is the same voicing path
            // the note-on handler gives its drained batches, over this
            // release's own route and ownership (#4870).
            // The receiving instrument the note-on handler voices generated notes
            // on, so a tail generated at the release reaches the same device.
            const toasterChildPad =
                resolveInstrumentTrack(instrumentTrackState, targetTrackId)?.toasterChildPad ?? null;
            const yeastReceiver = resolveLiveInputNoteReceiver(instrumentTrack.devices, toasterChildPad !== null);
            const voiceYeastEvents = (drainedEvents: readonly RealtimeMidiEvent[]): void => {
                for (const event of drainedEvents) {
                    const eventSampleFrame = drainedEventSampleFrame(event);
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
                            strip: audioEngine.getTrackStrip(instrumentTrackId),
                            engine: audioEngine,
                            context,
                            resolveDestination: () => audioEngine.ensureTrackStrip(instrumentTrackId).gainNode,
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
                                releaseVelocity,
                            })
                        ) {
                            continue;
                        }
                        if (event.trackId !== undefined && event.trackId !== instrumentTrackId) {
                            continue;
                        }
                        if (event.noteInstanceId !== undefined) {
                            // Instance-keyed voices release through the
                            // shared registry's releaseEvent above, from any
                            // session's drain (#4870). A note-off that did
                            // not resolve there is a repeat and must not fall
                            // through to the source-pitch release below.
                            continue;
                        }
                        if (
                            event.kind.channel !== noteData.channel ||
                            pendingYeastRelease.wasRetired(pendingRelease, eventNote)
                        ) {
                            continue;
                        }
                        pendingYeastRelease.release(pendingRelease, eventNote, eventSampleFrame, releaseVelocity);
                    }
                }
            };
            try {
                const processedEvents = await deps.processRealtimeMidiInput({
                    context,
                    rackId: yeastDevice.id,
                    routeId: instrumentTrack.id,
                    trackId: instrumentTrack.id,
                    note,
                    velocity: 0,
                    channel,
                    isNoteOn: false,
                    sampleTime,
                    sampleRate: context.sampleRate,
                    noteInstanceId: noteData.noteInstanceId,
                    onDrainedEvents: (drainedEvents) => {
                        // A reset ended the input session that owns this
                        // release's voices; the pump retires with it (#4870).
                        if (generation !== memberExpressionGeneration.current) {
                            return false;
                        }
                        if (
                            retireDrainOfRemovedYeast({
                                noteData,
                                yeastDeviceId: yeastDevice.id,
                                chainDevices: deps
                                    .getTrackStoreState()
                                    ?.tracks.find((track) => track.id === instrumentTrackId)?.devices,
                                sampleFrame: Math.round(context.currentTime * context.sampleRate),
                            })
                        ) {
                            return false;
                        }
                        voiceYeastEvents(drainedEvents);
                        return undefined;
                    },
                });
                // One voicing path for the ingress batch and every drained
                // idle-pump batch: a release-triggered tail's first generated
                // note rides this batch, and the source note's own release
                // still flows through the pending snapshot (#4870).
                voiceYeastEvents(processedEvents);
            } catch (error: unknown) {
                logger.warn('[MIDI] Yeast note release failed:', error);
                pendingYeastRelease.releaseAll(pendingRelease);
            } finally {
                pendingYeastRelease.finish(pendingRelease);
            }
        }

        if (noteData.nativeDeviceId) {
            void deps.sendNativeLiveMidiNote({
                trackId: instrumentTrackId,
                deviceId: noteData.nativeDeviceId,
                note,
                velocity: 0,
                channel: noteData.channel,
                isNoteOn: false,
            });
        }

        if (noteData.fermenterDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            // By instance id alone: a note-off has to release the very node its
            // note-on latched onto, so it must not fall back to the device kind.
            const deviceNode = resolveDeviceNode(strip, { deviceId: noteData.fermenterDeviceId });
            if (deviceNode?.fermenterControls) {
                deviceNode.fermenterControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        releaseActiveToasterNote(noteData, (trackId) => audioEngine.getTrackStrip(trackId));

        if (noteData.grandBouleDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const deviceNode = resolveDeviceNode(strip, { deviceId: noteData.grandBouleDeviceId });
            if (deviceNode?.grandBouleControls) {
                deviceNode.grandBouleControls.noteOff(note, dispatchFrame, releaseVelocity, noteData.channel);
            }
            void deps.eventBus.emit('midi.noteOff', {
                deviceId: noteData.grandBouleDeviceId,
                midiNote: note,
                releaseVelocity,
            });
        }

        if (noteData.levainDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const levainId = noteData.levainDeviceId;
            const deviceNode = resolveDeviceNode(strip, { deviceId: levainId });
            if (deviceNode?.levainControls) {
                deviceNode.levainControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        if (noteData.crumbsDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const deviceNode = resolveDeviceNode(strip, { deviceId: noteData.crumbsDeviceId });
            if (deviceNode?.crumbsControls) {
                deviceNode.crumbsControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        if (noteData.faustRelease) {
            // The closure is bound to the Faust device instance its note-on
            // started on, so the gate-off cannot drift to another device.
            noteData.faustRelease();
        }

        if (noteData.osc) {
            const now = dispatchFrame / audioEngine.context.sampleRate;
            const synthParams = deps.getSynthParamsForTrack(targetTrackId);
            const releaseTime = synthParams.release;
            if (noteData.osc._env) {
                noteData.osc._env.gain.cancelScheduledValues(now);
                noteData.osc._env.gain.setTargetAtTime(0, now, releaseTime / 3);
            }
            try {
                noteData.osc.stop(now + releaseTime + 0.05);
            } catch {
                // Already stopped.
            }
        }

        // The note belongs to the clip holding its admitted onset and is stored
        // at the beat its heard instant maps to, exactly as controller events
        // of the same take are.
        const placement = resolveRecordingPlacement(deps, {
            trackId: targetTrackId,
            admittedBeat: noteData.startBeat,
        });
        if (!placement) {
            return;
        }
        const {
            clipId,
            clipBeat: compensatedStartBeat,
            latencyAdjustedBeat: latencyAdjustedOnsetBeat,
            originSeconds,
            defaultTempo,
            flatTimeline,
        } = placement;

        // The end is read at the heard seconds from the SAME rewound
        // origin the start was placed with — the take conversion's
        // `originSeconds + buffer.duration` (#3650). Integrating from the
        // raw onset misplaces the end of a hold across a tempo change by
        // `latency × Δtempo`. The flat timeline keeps its closed form,
        // which already composes: start − L·t/60 … start + (D−L)·t/60.
        const durationSeconds = eventTime - noteData.startTime;
        let durationBeats = (durationSeconds * defaultTempo) / 60;
        if (!flatTimeline) {
            durationBeats =
                readBeatAtSamples({ samples: originSeconds + durationSeconds, sampleRate: 1 }) -
                latencyAdjustedOnsetBeat;
        }

        // Expression offsets share the compensated origin, so a curve
        // point lands on the beat its own heard instant maps to.
        const secondsToBeats = (seconds: number): number => {
            if (flatTimeline) {
                return (seconds * defaultTempo) / 60;
            }
            return readBeatAtSamples({ samples: originSeconds + seconds, sampleRate: 1 }) - latencyAdjustedOnsetBeat;
        };

        // Preserve the played velocity (was hardcoded 100, M-143).
        const midiNote = deps.createMidiNote(
            note,
            compensatedStartBeat,
            Math.max(durationBeats, 0.0625),
            noteData.velocity ?? DEFAULT_NOTE_VELOCITY
        );

        if (!getMpeEnabled()) {
            deps.appendRecordedMidiNote({ clipId, note: midiNote });
            return;
        }
        const recordedNote = withRecordedNoteExpression(midiNote, noteData, secondsToBeats);
        deps.appendRecordedMidiNote({ clipId, note: recordedNote });
    };
});
