import { projectClipControllerRestore } from '#/modules/MIDI/useCases';

import { type StoredControllerNode } from '../../models/StoredControllerNode';
import { noteStoredControllerMove, readStoredControllerEngagement } from '../../services/storedControllerEngagement';

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
    /** The beat playback was relocated to, and the sample frame it is posted at. */
    atBeat: number;
    sampleFrame: number;
    queue: SameFramePostQueue;
};

/**
 * Queue what one device must be told when playback is relocated to `atBeat` (a loop
 * wrap or a follow-action jump): the value in force there for each stored lane the
 * window opening at the destination does not emit itself, and the release of every
 * controller stored playback left engaged that no lane has a value for there.
 *
 * Without it a pedal pressed late in one pass stays down through every later pass
 * until the lane's next move, because a relocation stops notes but deliberately
 * keeps pedal state. The engaged set is read now, before this window posts
 * anything, so it is what earlier windows left; the release names exactly those
 * controllers, so a pedal the user holds live is never touched.
 */
export function restoreStoredControllers({
    trackId,
    device,
    node,
    clips,
    atBeat,
    sampleFrame,
    queue,
}: RestoreStoredControllersInput): void {
    const engaged = readStoredControllerEngagement(trackId, device.id);
    const held = new Set<number>();
    for (const { clip, controlChanges } of clips) {
        const restore = projectClipControllerRestore({ controlChanges, clip, atBeat });
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
    for (const controller of engaged) {
        if (!held.has(controller)) {
            stale.add(controller);
        }
    }
    if (stale.size === 0) {
        return;
    }
    queue.add('control', sampleFrame, () => {
        releaseStoredEngagement({ deviceType: device.type, node, controllers: stale, sampleFrame });
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
