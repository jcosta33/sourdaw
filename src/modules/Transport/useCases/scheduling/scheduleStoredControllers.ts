import { projectClipControllerEvents } from '#/modules/MIDI/useCases';

import { type StoredControllerNode } from '../../models/StoredControllerNode';

import { postStoredControllerMove } from './postStoredControllerMove';
import { type SameFramePostQueue } from './sameFramePostQueue';

type ClipControllerProjection = Parameters<typeof projectClipControllerEvents>[0];

type ScheduleStoredControllersInput = {
    trackId: string;
    device: { id: string; type: string };
    node: StoredControllerNode;
    controlChanges: ClipControllerProjection['controlChanges'];
    clip: ClipControllerProjection['clip'];
    /** The scheduler window `[fromBeat, toBeat)` this call owns. */
    fromBeat: number;
    toBeat: number;
    /** The sample frame a note at this beat is posted at. */
    sampleFrameAtBeat: (beat: number) => number;
    /** The window's posts to this track's instrument; the moves join it and post with its notes. */
    queue: SameFramePostQueue;
};

/**
 * Queue the stored controller moves a clip owns in one scheduler window for the
 * instrument that honours them, each at its own sample frame.
 *
 * The moves post with the window's notes, controllers ahead of the note-ons of
 * their frame and behind the note-offs, so a note struck on the same frame sounds
 * under the pedal or controller it was recorded with and a note released there is
 * not caught by it. Each pedal a move leaves engaged is recorded as it posts, so a
 * stop or a locate can release it.
 */
export function scheduleStoredControllers({
    trackId,
    device,
    node,
    controlChanges,
    clip,
    fromBeat,
    toBeat,
    sampleFrameAtBeat,
    queue,
}: ScheduleStoredControllersInput): void {
    const moves = projectClipControllerEvents({ controlChanges, clip, fromBeat, toBeat });
    for (const move of moves) {
        const sampleFrame = sampleFrameAtBeat(move.beat);
        queue.add('control', sampleFrame, () =>
            postStoredControllerMove({
                trackId,
                device,
                node,
                controller: move.controller,
                value: move.value,
                sampleFrame,
            })
        );
    }
}
