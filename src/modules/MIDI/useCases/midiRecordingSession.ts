import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { audioEngine, getCompensationDelay } from '#/modules/AudioEngine/useCases';
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import { readBeatAtSamples, readSecondsAtBeat, transportStore } from '#/modules/Transport/stores';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { createMidiChannelControllerState, type MidiChannelControllerState } from '../models/MidiControllerState';
import { channelControllerState } from '../repositories/webMidi/channelControllerState';
import { ingestChannelControlChangeInState } from '../repositories/webMidi/ingestChannelControlChange';
import { type MidiNote, type MidiCC, type MidiPitchBend } from '../models/MidiNote';
import { type MidiRecordingSessionApi, type MidiRecordingWitness } from '../models/MidiRecordingSession';
import { midiStore } from '../stores/midiStore';
import { type ActiveNoteData } from '../models/WebMidiTypes';
import { getMpeEnabled } from '../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../repositories/webMidi/getTargetTrackId';
import { memberExpressionState } from '../repositories/webMidi/memberExpressionState';

import { recordHeldNoteExpression } from './webMidiInput/recordHeldNoteExpression';
import { resolveBendRangeSemitones } from './webMidiInput/resolveBendRangeSemitones';
import { withRecordedNoteExpression } from './webMidiInput/withRecordedNoteExpression';

type Pass = { id: string; audioTime: number; timelineBeat: number; sourceBeat: number; endBeat?: number };
type CapturedNote = { witness: MidiRecordingWitness; data: ActiveNoteData; latency: number; endTime?: number };
type Carrier = { trackId: string; clipId: string; clipStartBeat: number; midiOffsetBeats?: number };
type Session = {
    id: string;
    punchOutBeat?: number;
    carriers: readonly Carrier[];
    passes: Pass[];
    held: Map<string, CapturedNote>;
    notes: CapturedNote[];
    cc: Map<string, MidiCC[]>;
    bends: Map<string, MidiPitchBend[]>;
    controllers: Map<number, MidiChannelControllerState>;
    members: Map<number, { pressure?: number; slide?: number; pitchBend?: number; pitchBendRangeSemitones?: number }>;
};
let session: Session | undefined;

export const cancelMidiRecordingSession: MidiRecordingSessionApi['cancelMidiRecordingSession'] = () => {
    session = undefined;
};

export const beginMidiRecordingSession: MidiRecordingSessionApi['beginMidiRecordingSession'] = (input) => {
    cancelMidiRecordingSession();
    if (input.carriers.length === 0) {
        return;
    }
    session = {
        id: `midi-recording-${crypto.randomUUID()}`,
        ...(input.punchOutBeat === undefined ? {} : { punchOutBeat: input.punchOutBeat }),
        carriers: structuredClone(input.carriers),
        passes: [
            {
                id: `recording-pass-${crypto.randomUUID()}`,
                audioTime: input.audioTime,
                timelineBeat: input.recordPointBeat,
                sourceBeat: 0,
            },
        ],
        held: new Map(),
        notes: [],
        cc: new Map(),
        bends: new Map(),
        members: new Map(),
        controllers: structuredClone(channelControllerState),
    };
};

/** A scheduled seam may be ahead of the cursor; admission chooses it by event time. */
export const advanceMidiRecordingPass: MidiRecordingSessionApi['advanceMidiRecordingPass'] = (input) => {
    if (!session || session.passes.some((pass) => Math.abs(pass.audioTime - input.audioTime) < 1e-8)) {
        return;
    }
    const previous = session.passes.at(-1)!;
    if (input.audioTime < previous.audioTime) {
        return;
    }
    previous.endBeat = input.fromBeat;
    session.passes.push({
        id: `recording-pass-${crypto.randomUUID()}`,
        audioTime: input.audioTime,
        timelineBeat: input.toBeat,
        sourceBeat: previous.sourceBeat + input.fromBeat - previous.timelineBeat,
    });
};

function passAt(current: Session, audioTime: number): Pass {
    return current.passes.findLast((pass) => pass.audioTime <= audioTime + 1e-9) ?? current.passes[0]!;
}

function sourceAt(current: Session, audioTime: number): number {
    const pass = passAt(current, audioTime);
    const songSeconds = readSecondsAtBeat({ beat: pass.timelineBeat }) + audioTime - pass.audioTime;
    return pass.sourceBeat + readBeatAtSamples({ samples: songSeconds, sampleRate: 1 }) - pass.timelineBeat;
}

function recordingBendRange(current: Session, channel: number): number {
    return (
        current.controllers.get(channel)?.bendRangeSemitones ??
        current.controllers.get(0)?.bendRangeSemitones ??
        resolveBendRangeSemitones({ channel, mpeEnabled: getMpeEnabled() })
    );
}

function keyOf(channel: number, note: number): string {
    return `${channel}:${note}`;
}

function closeHeld(current: Session, key: string, audioTime: number): CapturedNote | undefined {
    const held = current.held.get(key);
    if (held) {
        held.endTime = Math.max(held.witness.audioTime, audioTime);
        current.held.delete(key);
    }
    return held;
}

export const admitMidiRecordingEvent: MidiRecordingSessionApi['admitMidiRecordingEvent'] = ({ event, time }) => {
    const current = session;
    if (!current || transportStore.value?.isRecording !== true) {
        return undefined;
    }
    // Input is admitted at its own time, before any worker or scheduler tick.
    // A delayed tick cannot extend the punched interval, and a pre-window
    // timestamp cannot be clamped into the take as a spurious downbeat.
    if (current.punchOutBeat !== undefined) {
        const terminalPass = current.passes.find(
            (pass) =>
                pass.timelineBeat <= current.punchOutBeat! &&
                (pass.endBeat === undefined || pass.endBeat >= current.punchOutBeat!)
        );
        const outTime =
            terminalPass === undefined
                ? Infinity
                : terminalPass.audioTime +
                  readSecondsAtBeat({ beat: current.punchOutBeat }) -
                  readSecondsAtBeat({ beat: terminalPass.timelineBeat });
        if (time.audioTime + 1e-9 < current.passes[0]!.audioTime || time.audioTime + 1e-9 >= outTime) return undefined;
    }
    const release = event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0);
    if (release && (event.type === 'noteOff' || event.type === 'noteOn')) {
        return closeHeld(current, keyOf(event.channel, event.note), time.audioTime)?.witness;
    }
    const mpe = getMpeEnabled() && event.channel >= 1;
    let expression = event.type === 'expression' ? event : undefined;
    if (mpe && event.type === 'cc' && event.controller === 74) {
        expression = { type: 'expression', channel: event.channel, dimension: 'slide', value: event.value };
    }
    if (mpe && event.type === 'pitchBend') {
        expression = {
            type: 'expression',
            channel: event.channel,
            dimension: 'pitchBend',
            value: event.value,
            bendRangeSemitones: recordingBendRange(current, event.channel),
        };
    }
    if (expression && mpe) {
        current.members.set(event.channel, {
            ...(current.members.get(event.channel) ?? memberExpressionState.get(event.channel)),
            [expression.dimension]: expression.value,
            ...(expression.bendRangeSemitones === undefined
                ? {}
                : { pitchBendRangeSemitones: expression.bendRangeSemitones }),
        });
        for (const held of current.held.values()) {
            if (held.data.channel !== event.channel) continue;
            recordHeldNoteExpression(held.data, {
                dimension: expression.dimension,
                value: expression.value,
                eventTime: time.audioTime,
                bendRangeSemitones: expression.bendRangeSemitones,
            });
            held.data[expression.dimension] = expression.value;
            if (expression.dimension === 'pitchBend') held.data.pitchBendRangeSemitones = expression.bendRangeSemitones;
        }
        return [...current.held.values()].find((held) => held.data.channel === event.channel)?.witness;
    }
    const trackId = getTargetTrackId();
    const carrier = current.carriers.find((candidate) => candidate.trackId === trackId);
    if (!carrier || !trackStore.value?.tracks.some((track) => track.id === carrier.trackId && track.armed)) {
        return undefined;
    }
    const latency =
        (audioEngine.context.baseLatency || 0) +
        (audioEngine.context.outputLatency || 0) +
        getCompensationDelay(carrier.trackId);
    const heardTime = time.audioTime - latency;
    const pass = passAt(current, heardTime);
    const sourceBeat = Math.max(0, sourceAt(current, heardTime) + (carrier.midiOffsetBeats ?? 0));
    const timelineBeat = time.recordingBeat ?? pass.timelineBeat + sourceBeat - pass.sourceBeat;
    const heardBeat = pass.timelineBeat + sourceAt(current, heardTime) - pass.sourceBeat;
    const witness: MidiRecordingWitness = {
        sessionId: current.id,
        recordingPassId: pass.id,
        trackId: carrier.trackId,
        clipId: carrier.clipId,
        timelineBeat,
        sourceBeat,
        audioTime: time.audioTime,
    };
    if (event.type === 'noteOn') {
        const key = keyOf(event.channel, event.note);
        closeHeld(current, key, time.audioTime);
        // MPE has one held note per member channel, independently of voice-worker state.
        if (mpe) {
            for (const [heldKey, held] of current.held) {
                if (held.data.channel === event.channel) closeHeld(current, heldKey, time.audioTime);
            }
        }
        const member = mpe
            ? (current.members.get(event.channel) ?? memberExpressionState.get(event.channel))
            : undefined;
        const captured: CapturedNote = {
            witness: { ...witness, noteId: `note-${crypto.randomUUID()}` },
            latency,
            data: {
                startTime: time.audioTime,
                startBeat: timelineBeat,
                channel: event.channel,
                note: event.note,
                velocity: event.velocity,
                trackId: carrier.trackId,
                instrumentTrackId: carrier.trackId,
                ...member,
            },
        };
        if (member?.pitchBend !== undefined)
            captured.data.pitchBendRangeSemitones = recordingBendRange(current, event.channel);
        current.held.set(key, captured);
        current.notes.push(captured);
        return captured.witness;
    }
    if (event.type === 'cc') {
        const controller = current.controllers.get(event.channel) ?? createMidiChannelControllerState();
        const earlierRange = recordingBendRange(current, event.channel);
        current.controllers.set(event.channel, controller);
        const decoded = ingestChannelControlChangeInState(controller, { cc: event.controller, value: event.value });
        const nextRange = recordingBendRange(current, event.channel);
        if (mpe && nextRange !== earlierRange) {
            for (const held of current.held.values()) {
                if (held.data.channel !== event.channel || held.data.pitchBend === undefined) continue;
                recordHeldNoteExpression(held.data, {
                    dimension: 'pitchBend',
                    value: held.data.pitchBend,
                    eventTime: time.audioTime,
                    bendRangeSemitones: nextRange,
                });
                held.data.pitchBendRangeSemitones = nextRange;
            }
        }
        const learn = midiLearnStore.value;
        if (
            learn?.isLearning ||
            (!decoded.consumed &&
                learn?.mappings.some((mapping) => mapping.channel === event.channel && mapping.cc === decoded.cc)) ||
            event.controller >= 120
        )
            return witness;
        const rows = current.cc.get(carrier.clipId) ?? [];
        rows.push({
            id: `cc-${crypto.randomUUID()}`,
            controller: event.controller,
            value: event.value,
            channel: event.channel,
            beat: Math.max(0, heardBeat - carrier.clipStartBeat + (carrier.midiOffsetBeats ?? 0)),
        });
        current.cc.set(carrier.clipId, rows);
    } else if (event.type === 'pitchBend') {
        const rows = current.bends.get(carrier.clipId) ?? [];
        rows.push({
            id: `bend-${crypto.randomUUID()}`,
            value: event.value,
            channel: event.channel,
            beat: Math.max(0, heardBeat - carrier.clipStartBeat + (carrier.midiOffsetBeats ?? 0)),
        });
        current.bends.set(carrier.clipId, rows);
    }
    return witness;
};

/** Detach first: no queued handler or worker can extend the frozen gesture. */
export const sealMidiRecordingSession: MidiRecordingSessionApi['sealMidiRecordingSession'] = (ending) => {
    const current = session;
    session = undefined;
    if (!current) return [];
    for (const key of current.held.keys()) {
        const held = current.held.get(key)!;
        closeHeld(current, key, ending.audioTime + (current.punchOutBeat === undefined ? 0 : held.latency));
    }
    return current.carriers.map((carrier) => {
        const capturedNotes = current.notes.filter((note) => note.witness.clipId === carrier.clipId);
        const notes: MidiNote[] = [
            ...structuredClone(midiStore.value?.notesByClipId[carrier.clipId] ?? []),
            ...capturedNotes.map((captured) => {
                const start = captured.witness.sourceBeat;
                const endTime = Math.min(
                    captured.endTime ?? ending.audioTime,
                    ending.audioTime + (current.punchOutBeat === undefined ? 0 : captured.latency)
                );
                const durationAt = (seconds: number) =>
                    sourceAt(current, captured.witness.audioTime + seconds - captured.latency) -
                    sourceAt(current, captured.witness.audioTime - captured.latency);
                const duration = Math.max(0.0625, durationAt(endTime - captured.witness.audioTime));
                // The ordinary minimum note length cannot extend a punched
                // tail past its exclusive source boundary.
                const sourceEnd = sourceAt(current, ending.audioTime) + (carrier.midiOffsetBeats ?? 0);
                const note: MidiNote = {
                    id: captured.witness.noteId!,
                    recordingPassId: captured.witness.recordingPassId,
                    pitch: captured.data.note,
                    startBeat: start,
                    duration:
                        current.punchOutBeat === undefined
                            ? duration
                            : Math.max(0, Math.min(duration, sourceEnd - start)),
                    velocity: captured.data.velocity ?? 100,
                };
                return withRecordedNoteExpression(note, captured.data, durationAt);
            }),
        ];
        const laneIndex = takeLaneStore.value?.lanes.findIndex((lane) => lane.trackId === carrier.trackId) ?? -1;
        const liveLane = takeLaneStore.value?.lanes[laneIndex];
        const takeLanes: RetiredTakeLaneSnapshot[] = [];
        if (liveLane) {
            const recordedTakes = current.passes
                .filter(
                    (pass) =>
                        pass.audioTime < ending.audioTime && notes.some((note) => note.recordingPassId === pass.id)
                )
                .map((pass, index) => ({
                    id: `take-${pass.id}-${carrier.clipId}`,
                    clipId: carrier.clipId,
                    name: `Take ${liveLane.takes.filter((take) => take.clipId !== carrier.clipId).length + index + 1}`,
                    selected: false,
                    recordingPassId: pass.id,
                    startBeat: pass.timelineBeat,
                    endBeat: Math.min(
                        pass.endBeat ?? ending.timelineBeat,
                        passAt(current, ending.audioTime).id === pass.id ? ending.timelineBeat : Infinity
                    ),
                    sourceOffsetBeats: pass.sourceBeat + carrier.clipStartBeat - pass.timelineBeat,
                }));
            const takes =
                capturedNotes.length === 0
                    ? liveLane.takes
                          .filter((take) => take.clipId === carrier.clipId)
                          .map((take) => ({ ...take, endBeat: Math.max(take.startBeat + 1, ending.timelineBeat) }))
                    : recordedTakes;
            const lane = {
                ...structuredClone(liveLane),
                takes: [...liveLane.takes.filter((take) => take.clipId !== carrier.clipId), ...takes],
            };
            takeLanes.push({ laneIndex, lane, retiredTakeIds: takes.map((take) => take.id) });
        }
        return {
            clipId: carrier.clipId,
            midiRecording: {
                data: {
                    notes: { present: true, value: notes },
                    controlChanges: {
                        present: true,
                        value: [
                            ...structuredClone(midiStore.value?.ccByClipId[carrier.clipId] ?? []),
                            ...(current.cc.get(carrier.clipId) ?? []),
                        ],
                    },
                    pitchBends: {
                        present: true,
                        value: [
                            ...structuredClone(midiStore.value?.pitchBendByClipId[carrier.clipId] ?? []),
                            ...(current.bends.get(carrier.clipId) ?? []),
                        ],
                    },
                },
                takeLanes,
            },
        };
    });
};
