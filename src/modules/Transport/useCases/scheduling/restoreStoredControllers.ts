import { projectClipControllerRestore } from '#/modules/MIDI/useCases';
import { LEVAIN_CONTROLLER_DEFAULTS } from '#/utils/levainControllerDefaults';

import { type StoredControllerNode } from '../../models/StoredControllerNode';
import {
    noteStoredControllerMove,
    noteStoredControllerPost,
    readStoredControllerPostedControllers,
    readStoredControllerPostedPedals,
} from '../../services/storedControllerEngagement';

import { postStoredControllerMove } from './postStoredControllerMove';
import { releaseStoredEngagement } from './releaseStoredEngagement';
import { type SameFramePostQueue } from './sameFramePostQueue';

export type RestoreStoredControllersInput = {
    trackId: string;
    device: { id: string; type: string };
    node: StoredControllerNode;
    /** Every clip of the track that plays on this device and carries stored controllers, wherever it sits against the destination. */
    clips: Parameters<typeof projectClipControllerRestore>[0]['clips'];
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
 * each stored controller the window opening at the destination does not end on itself,
 * the lift of every pedal stored playback moved that no row has a value for there, and
 * the return of every other controller stored playback moved to the instrument's default
 * (a Levain CC1, CC2, CC7 or CC11) when no row has a value for it.
 *
 * Without it a pedal pressed late in one pass stays down through every later pass
 * until the lane's next move, because a relocation stops notes but deliberately
 * keeps pedal state, and a swell left at CC11 0 stays silent as well. A pedal that has a
 * value in force is only given that value, never lifted first: a Grand Boule releases
 * the voices a lifted sustain was holding, and pressing it again does not bring them
 * back. The moved set is every pedal posted so far, not those whose last post was a
 * press, because the discard of a still-queued lift leaves the pedal wherever the last
 * applied move put it. The lift names exactly the pedals stored playback moved, so a
 * pedal the user holds live is never touched.
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
    const movedPedals = readStoredControllerPostedPedals(trackId, device.id);
    const movedControllers = readStoredControllerPostedControllers(trackId, device.id);
    const sampleFrame = sampleFrameAtBeat(atBeat);
    const restore = projectClipControllerRestore({ clips, atBeat, windowToBeat, sampleFrameAtBeat });
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
    const stalePedals = new Set<number>();
    for (const controller of movedPedals) {
        if (!restore.held.has(controller)) {
            stalePedals.add(controller);
        }
    }
    const staleDefaults = new Map<number, number>();
    for (const controller of movedControllers) {
        const fallback = device.type === 'levain' ? LEVAIN_CONTROLLER_DEFAULTS.get(controller) : undefined;
        if (!restore.held.has(controller) && fallback !== undefined) {
            staleDefaults.set(controller, fallback);
        }
    }
    if (stalePedals.size > 0) {
        queue.add('control', sampleFrame, () => {
            releaseStoredEngagement({ deviceType: device.type, node, controllers: stalePedals, sampleFrame });
            noteStoredControllerPost({ trackId, deviceId: device.id, deviceType: device.type });
            for (const controller of stalePedals) {
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
    for (const [controller, value] of staleDefaults) {
        queue.add('control', sampleFrame, () =>
            postStoredControllerMove({ trackId, device, node, controller, value, sampleFrame })
        );
    }
}
