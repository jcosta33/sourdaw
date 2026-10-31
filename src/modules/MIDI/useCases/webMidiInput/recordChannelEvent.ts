import { logger } from '#/infra/logger/appLogger';
import { activeRecordingRef } from '#/modules/Arrangement/stores';

import { type MidiCC } from '../../models/MidiNote';

import { isRecordingOnArmedTrack } from './isRecordingOnArmedTrack';
import { type midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { recordingMidiAdmissionPort } from './recordingMidiAdmissionPort';
import { type RecordingPlacementDependencies } from './recordingPlacementDependencies';
import { resolveAdmittedEventPosition } from './resolveAdmittedEventPosition';
import { resolveInputEventTime, type CapturedInputEventTime } from './resolveInputEventTime';
import { resolveRecordingPlacement } from './resolveRecordingPlacement';

export type RecordableChannelEvent =
    | {
          kind: 'controlChange';
          controller: number;
          value: number;
          /** The input's registered-parameter state before this message moved it, when the message is one. */
          registeredStateBefore?: readonly MidiCC[];
      }
    | { kind: 'pitchBend'; value: number };

type RecordChannelEventInput = {
    /** Track the live input is routed to; `null` when none is selected. */
    trackId: string | null;
    channel: number;
    event: RecordableChannelEvent;
    timeStamp: number | CapturedInputEventTime | undefined;
};

export type RecordChannelEventDependencies = RecordingPlacementDependencies &
    Pick<typeof midiMessageHandlerDependencies, 'bufferRecordedMidiCC' | 'bufferRecordedMidiPitchBend'>;

/**
 * Record a channel controller or pitch-bend event into the take being recorded.
 *
 * The event is filed under the clip at the same latency-adjusted source beat
 * as a note-on arriving on its captured pass. It waits in the take's
 * in-memory buffer rather than the MIDI store, whose every write reconciles the
 * clip's whole row list: the recording commit flushes the buffer in one write
 * ahead of its snapshot and owns the undo of the whole take. Every message is
 * kept in arrival order, so same-beat controllers all survive.
 *
 * A failed buffering is logged and dropped rather than thrown: the caller is
 * also voicing the live event, and a recording fault must never silence the
 * instrument the musician is playing.
 */
export function recordChannelEvent(
    deps: RecordChannelEventDependencies,
    { trackId, channel, event, timeStamp }: RecordChannelEventInput
): void {
    if (trackId === null || !isRecordingOnArmedTrack(deps, trackId)) {
        return;
    }
    const eventTime = resolveInputEventTime({ timeStamp });
    const admittedPosition = resolveAdmittedEventPosition({ timeStamp, eventTime });
    const placement = resolveRecordingPlacement(deps, {
        trackId,
        admittedBeat: admittedPosition.beat,
    });
    if (!placement) {
        return;
    }
    try {
        let rowBeat = placement.clipBeat;
        if (activeRecordingRef.current.includes(placement.clipId)) {
            const sourceBeat = recordingMidiAdmissionPort.recordingMidiSourceBeatAt(placement.clipId, admittedPosition);
            if (sourceBeat === null) {
                return;
            }
            rowBeat = Math.max(0, sourceBeat - (admittedPosition.beat - placement.latencyAdjustedBeat));
        }
        if (event.kind === 'controlChange') {
            deps.bufferRecordedMidiCC({
                clipId: placement.clipId,
                row: { controller: event.controller, value: event.value, beat: rowBeat, channel },
                registeredStateBefore: event.registeredStateBefore,
            });
            return;
        }
        deps.bufferRecordedMidiPitchBend({
            clipId: placement.clipId,
            row: { value: event.value, beat: rowBeat, channel },
        });
    } catch (error: unknown) {
        logger.warn('[MIDI] Recording a channel event failed:', error);
    }
}
