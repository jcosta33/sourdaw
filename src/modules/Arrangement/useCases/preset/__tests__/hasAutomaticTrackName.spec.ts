import { describe, expect, it } from 'vitest';

import { nextDefaultTrackName } from '../../../models/DefaultTrackName';
import { hasAutomaticTrackName } from '../hasAutomaticTrackName';

describe('hasAutomaticTrackName', () => {
    it.each(['audio', 'midi', 'bus', 'folder', 'master'] as const)(
        'treats every default name generated for a %s track as automatic',
        (kind) => {
            const first = nextDefaultTrackName(kind, []);
            const second = nextDefaultTrackName(kind, [{ kind, name: first }]);

            for (const name of [first, second]) {
                expect(hasAutomaticTrackName({ kind, name })).toBe(true);
            }
        }
    );

    it('keeps the bare defaults tracks were created with before numbering', () => {
        expect(hasAutomaticTrackName({ kind: 'midi', name: 'MIDI' })).toBe(true);
        expect(hasAutomaticTrackName({ kind: 'audio', name: 'Audio' })).toBe(true);
    });

    it('treats a name the user chose as not automatic', () => {
        expect(hasAutomaticTrackName({ kind: 'midi', name: 'Lead' })).toBe(false);
        expect(hasAutomaticTrackName({ kind: 'midi', name: 'MIDI 2 copy' })).toBe(false);
    });

    it("treats another kind's default name the user gave a track as chosen", () => {
        expect(hasAutomaticTrackName({ kind: 'audio', name: 'Bus 1' })).toBe(false);
        expect(hasAutomaticTrackName({ kind: 'midi', name: 'Folder' })).toBe(false);
        expect(hasAutomaticTrackName({ kind: 'audio', name: 'Master' })).toBe(false);
        expect(hasAutomaticTrackName({ kind: 'midi', name: 'Audio 2' })).toBe(false);
    });
});
