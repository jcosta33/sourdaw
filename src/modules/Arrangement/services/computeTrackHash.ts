import { type Clip, type Device } from '../models/Track';

/**
 * Computes a SHA-256 hash of the track's content (clips and devices)
 * to detect when a frozen track becomes stale due to user edits.
 *
 * Conforms to R3: Content Hash Computation.
 */
export async function computeTrackHash(clips: Clip[], devices: Device[]): Promise<string> {
    const sortedClips = [...clips].sort(
        (alpha, buffer) => alpha.startBeat - buffer.startBeat || alpha.id.localeCompare(buffer.id)
    );
    const clipStrings = sortedClips.map((clip) => {
        const duration = clip.endBeat - clip.startBeat;
        return `${clip.id}:${clip.startBeat}:${duration}:${clip.assetHash ?? ''}:${clip.gain}`;
    });

    const deviceStrings = devices.map((device) => {
        const sortedParams = Object.entries(device.parameterValues)
            .sort(([alpha], [buffer]) => alpha.localeCompare(buffer))
            .map(([kIndex, value]) => `${kIndex}=${value}`)
            .join(',');
        return `${device.id}:${device.type}:${sortedParams}:${device.bypassed}`;
    });

    const contentString = `${clipStrings.join('|')}||${deviceStrings.join('|')}`;

    const encoder = new TextEncoder();
    const data = encoder.encode(contentString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((buffer) => buffer.toString(16).padStart(2, '0')).join('');
}
