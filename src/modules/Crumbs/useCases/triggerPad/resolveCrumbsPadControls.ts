import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip, type getTrackStrip } from '#/modules/AudioEngine/useCases';

/**
 * The live strip and device-node shapes, taken from the engine accessor that
 * produces them rather than re-declared structurally — the same derivation
 * `findToasterNodeOnStrip` makes, and for the same reason: a hand-written
 * stand-in drifts from `BuiltinDeviceNode` silently.
 */
type CrumbsStripDeviceNode = NonNullable<ReturnType<typeof getTrackStrip>>['deviceNodes'][number];
type CrumbsControls = NonNullable<CrumbsStripDeviceNode['crumbsControls']>;

/**
 * The Web Audio Crumbs node for *this* device, once it can take a note.
 *
 * Modelled on `sendCrumbsModeToEngine`, including the part that matters: the
 * device id locates the owning track **and** selects the node, so a track
 * hosting two samplers addresses the one the caller named rather than whichever
 * answers first.
 *
 * `null` for a device with no strip, no node, or a node whose wasm module is
 * still loading — each of them ordinary, and each of them a node that would
 * drop the note anyway.
 */
export function resolveCrumbsPadControls(deviceId: string): CrumbsControls | null {
    const track = getAllTracks().find((candidate) => candidate.devices.some((device) => device.id === deviceId));
    if (!track) {
        return null;
    }
    const deviceNode = ensureTrackStrip(track.id).deviceNodes.find(
        (candidate) => candidate.deviceId === deviceId && candidate.crumbsControls?.ready === true
    );
    return deviceNode?.crumbsControls ?? null;
}
