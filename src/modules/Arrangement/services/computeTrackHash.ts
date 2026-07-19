import { type Clip, type Device } from '../models/Track';

import { createTrackFreezeSourceSignature } from './createTrackFreezeSourceSignature';

/**
 * Computes a SHA-256 hash of the track's content (clips and devices)
 * to detect when a frozen track becomes stale due to user edits.
 *
 * Conforms to R3: Content Hash Computation.
 */
export async function computeTrackHash(clips: Clip[], devices: Device[]): Promise<string> {
    const contentString = createTrackFreezeSourceSignature({ clips, devices });

    const encoder = new TextEncoder();
    const data = encoder.encode(contentString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((buffer) => buffer.toString(16).padStart(2, '0')).join('');
}
