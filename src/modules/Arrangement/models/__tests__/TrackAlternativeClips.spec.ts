import { describe, expect, it } from 'vitest';

import { getAlternativeClips } from '../TrackAlternativeClips';

// The law only hands clip arrays back, so a bare identity is enough.
function clipWithId(id: string): { id: string } {
    return { id };
}

describe('getAlternativeClips', () => {
    const live = [clipWithId('live')];
    const storedActive = [clipWithId('deleted-from-main-row')];
    const inactive = [clipWithId('parked')];
    const track = { activeAlternativeId: 'active', clips: live };

    it("returns the track's live clips for the active alternative, not its stored copy", () => {
        expect(getAlternativeClips(track, { id: 'active', clips: storedActive })).toBe(live);
    });

    it("returns an inactive alternative's own clips", () => {
        expect(getAlternativeClips(track, { id: 'other', clips: inactive })).toBe(inactive);
    });
});
