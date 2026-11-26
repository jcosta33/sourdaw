import { type Track } from '#/modules/Arrangement/stores';

import { findPadOutputHost } from '../deviceCapabilities/findPadOutputHost';

/** One Toaster of a render and the ids of its child tracks, in the order the render assigns them pads. */
export type ToasterPadOrder = {
    toasterId: string;
    childIds: readonly string[];
};

/**
 * The pad order of every Toaster among `renderTracks`: the render gives each child the pad that is its
 * position among the Toaster's children in the order the render holds its tracks, so that order, and
 * no other track's, decides which pad a child's clips print on.
 *
 * A Toaster is a track whose chain holds a pad-output host the render builds: the chain builds no node
 * for a bypassed device, so the pad routes find no host on it and a bypassed receiver plays no clips.
 * The note-receiver rule for gathering clips (the first instrument in the chain) selects a subset of
 * these, so signing the order for every such track covers both paths.
 */
export function readToasterPadOrder(renderTracks: readonly Track[]): ToasterPadOrder[] {
    return renderTracks
        .filter((track) => findPadOutputHost(track.devices.filter((device) => !device.bypassed)) !== undefined)
        .map((toaster) => ({
            toasterId: toaster.id,
            childIds: renderTracks.filter((track) => track.parentId === toaster.id).map((track) => track.id),
        }))
        .toSorted((left, right) => left.toasterId.localeCompare(right.toasterId));
}
