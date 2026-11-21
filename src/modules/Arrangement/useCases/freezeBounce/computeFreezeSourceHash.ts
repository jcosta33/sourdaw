import { type Track } from '../../models/Track';
import { computeTrackHash } from '../../services/computeTrackHash';

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The source signature of a freeze: one digest over every track its render reads, so an edit to
 * any of them, or a routing change that adds or removes one, changes it. `tracks` come from
 * `selectFreezeSourceTracks`, already in id order. A freeze that reads only its own track keeps
 * that track's own hash, so projects frozen before routed sources were covered stay comparable.
 */
export async function computeFreezeSourceHash(tracks: Track[]): Promise<string> {
    const [only, ...others] = tracks;
    if (only !== undefined && others.length === 0) {
        return computeTrackHash(only.clips, only.devices);
    }
    const lines: string[] = [];
    for (const track of tracks) {
        lines.push(`${JSON.stringify(track.id)}:${await computeTrackHash(track.clips, track.devices)}`);
    }
    return sha256Hex(lines.join('\n'));
}
