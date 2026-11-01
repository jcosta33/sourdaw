import { describe, expect, it } from 'vitest';

import { getAlternativeClips, getHeldClips } from '../TrackAlternativeClips';

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

describe('getHeldClips', () => {
    it("lists the track's clips and each inactive alternative's clips, leaving out the active alternative's stored copy", () => {
        const track = {
            activeAlternativeId: 'active',
            clips: [clipWithId('live')],
            alternatives: [
                { id: 'active', clips: [clipWithId('live'), clipWithId('deleted-from-main-row')] },
                { id: 'parked', clips: [clipWithId('parked')] },
                { id: 'also-parked', clips: [clipWithId('also-parked')] },
            ],
        };

        expect(getHeldClips(track).map((clip) => clip.id)).toEqual(['live', 'parked', 'also-parked']);
    });

    it('treats every alternative as inactive when none is the active one', () => {
        const track = {
            activeAlternativeId: 'missing',
            clips: [clipWithId('live')],
            alternatives: [{ id: 'only', clips: [clipWithId('stored')] }],
        };

        expect(getHeldClips(track).map((clip) => clip.id)).toEqual(['live', 'stored']);
    });
});
