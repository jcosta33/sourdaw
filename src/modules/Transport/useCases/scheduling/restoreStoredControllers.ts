import { projectClipControllerRestore } from '#/modules/MIDI/useCases';

import { type StoredControllerNode } from '../../models/StoredControllerNode';
import {
    noteStoredControllerMove,
    noteStoredControllerPost,
    readStoredControllerPostedPedals,
} from '../../services/storedControllerEngagement';

import { postStoredControllerMove } from './postStoredControllerMove';
import { releaseStoredEngagement } from './releaseStoredEngagement';
import { type SameFramePostQueue } from './sameFramePostQueue';

export type RestoreStoredControllersInput = {
    trackId: string;
    device: { id: string; type: string };
    node: StoredControllerNode;
    /** Every clip of the track that plays on this device and carries stored controllers. */
    clips: {
        clip: Parameters<typeof projectClipControllerRestore>[0]['clip'];
        controlChanges: Parameters<typeof projectClipControllerRestore>[0]['controlChanges'];
    }[];
    /** The beat playback was relocated to, where the window `[atBeat, windowToBeat)` this track schedules opens. */
    atBeat: number;
    windowToBeat: number;
    /** The sample frame a note at this beat is posted at: the destination's frame, and the test of "at the same time". */
    sampleFrameAtBeat: (beat: number) => number;
    queue: SameFramePostQueue;
};

/**
 * Queue what one device must be told when playback is relocated to `atBeat` (a loop
 * wrap, a follow-action jump or an edit's re-emit): the value in force there for
 * each stored lane the window opening at the destination does not emit itself, and
 * the lift of every pedal stored playback moved that no lane has a value for there.
 *
 * Without it a pedal pressed late in one pass stays down through every later pass
 * until the lane's next move, because a relocation stops notes but deliberately
 * keeps pedal state. A pedal that has a value in force is only given that value,
 * never lifted first: a Grand Boule releases the voices a lifted sustain was
 * holding, and pressing it again does not bring them back. The moved set is every
 * pedal posted so far, not those whose last post was a press, because the discard
 * of a still-queued lift leaves the pedal wherever the last applied move put it.
 * The lift names exactly the pedals stored playback moved, so a pedal the user
 * holds live is never touched.
 */
export function restoreStoredControllers({
    trackId,
    device,
    node,
    clips,
    atBeat,
    windowToBeat,
    sampleFrameAtBeat,
    queue,
}: RestoreStoredControllersInput): void {
    const moved = readStoredControllerPostedPedals(trackId, device.id);
    const sampleFrame = sampleFrameAtBeat(atBeat);
    const held = new Set<number>();
    for (const { clip, controlChanges } of clips) {
        const restore = projectClipControllerRestore({
            controlChanges,
            clip,
            atBeat,
            windowToBeat,
            onDestinationFrame: (beat) => sampleFrameAtBeat(beat) === sampleFrame,
        });
        for (const controller of restore.held) {
            held.add(controller);
        }
        for (const move of restore.moves) {
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
    const stale = new Set<number>();
    for (const controller of moved) {
        if (!held.has(controller)) {
            stale.add(controller);
        }
    }
    if (stale.size === 0) {
        return;
    }
    queue.add('control', sampleFrame, () => {
        releaseStoredEngagement({ deviceType: device.type, node, controllers: stale, sampleFrame });
        noteStoredControllerPost({ trackId, deviceId: device.id, deviceType: device.type });
        for (const controller of stale) {
            noteStoredControllerMove({
                trackId,
                deviceId: device.id,
                deviceType: device.type,
                controller,
                engaged: false,
            });
        }
    });
}
