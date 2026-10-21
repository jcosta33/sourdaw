import { logger } from '#/infra/logger/appLogger';

import { isRecordingOnArmedTrack } from './isRecordingOnArmedTrack';
import { type midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { type RecordingPlacementDependencies } from './recordingPlacementDependencies';
import { resolveAdmittedEventBeat } from './resolveAdmittedEventBeat';
import { resolveInputEventTime, type CapturedInputEventTime } from './resolveInputEventTime';
import { resolveRecordingPlacement } from './resolveRecordingPlacement';

export type RecordableChannelEvent =
    { kind: 'controlChange'; controller: number; value: number } | { kind: 'pitchBend'; value: number };

type RecordChannelEventInput = {
    /** Track the live input is routed to; `null` when none is selected. */
    trackId: string | null;
    channel: number;
    event: RecordableChannelEvent;
    timeStamp: number | CapturedInputEventTime | undefined;
};

export type RecordChannelEventDependencies = RecordingPlacementDependencies &
    Pick<typeof midiMessageHandlerDependencies, 'addPitchBend' | 'appendRecordedMidiCC'>;

/**
 * Write a channel controller or pitch-bend event into the take being recorded.
 *
 * The event lands in the clip, at the clip-relative beat, a note-on arriving at
 * the same instant would be filed under. It is written straight to the MIDI
 * store with no undo entry of its own: the recording commit snapshots the
 * clip's controller rows and owns the undo of the whole take. Every message is
 * appended in arrival order, so same-beat controllers all survive.
 *
 * A failed write is logged and dropped rather than thrown: the caller is also
 * voicing the live event, and a recording fault must never silence the
 * instrument the musician is playing.
 */
export function recordChannelEvent(
    deps: RecordChannelEventDependencies,
    { trackId, channel, event, timeStamp }: RecordChannelEventInput
): void {
    if (
        (typeof timeStamp === 'object' && timeStamp?.recordingAdmitted === true) ||
        trackId === null ||
        !isRecordingOnArmedTrack(deps, trackId)
    ) {
        return;
    }
    const eventTime = resolveInputEventTime({ timeStamp });
    const placement = resolveRecordingPlacement(deps, {
        trackId,
        admittedBeat: resolveAdmittedEventBeat({ timeStamp, eventTime }),
    });
    if (!placement) {
        return;
    }
    try {
        if (event.kind === 'controlChange') {
            deps.appendRecordedMidiCC({
                clipId: placement.clipId,
                row: { controller: event.controller, value: event.value, beat: placement.clipBeat, channel },
            });
            return;
        }
        deps.addPitchBend(placement.clipId, event.value, placement.clipBeat, channel);
    } catch (error: unknown) {
        logger.warn('[MIDI] Recording a channel event failed:', error);
    }
}
