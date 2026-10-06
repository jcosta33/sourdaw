import { describe, it, expect, vi, beforeEach } from 'vitest';

import { restoreSectionBeats } from '../restoreSectionBeats';

type SectionFixture = { id: string; startBeat: number; endBeat: number };
type SectionState = { sections: SectionFixture[] };

const mocks = vi.hoisted(() => {
    const holder: { value: SectionState | null } = { value: { sections: [] } };
    return {
        markerStoreValue: holder,
        markerStoreSet: vi.fn<(state: SectionState) => void>(),
    };
});

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: mocks.markerStoreSet,
    },
}));

describe('restoreSectionBeats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function writtenSections(): SectionFixture[] {
        const newState = mocks.markerStoreSet.mock.calls[0]?.[0];
        if (!newState) {
            throw new Error('expected markerStore.set to have been called');
        }
        return newState.sections;
    }

    it('moves both sections back when the recorded swap can still close', () => {
        mocks.markerStoreValue.value = {
            sections: [
                { id: 's2', startBeat: 0, endBeat: 16 },
                { id: 's1', startBeat: 16, endBeat: 32 },
            ],
        };

        restoreSectionBeats([
            { sectionId: 's1', startBeat: 0, endBeat: 16, index: 0 },
            { sectionId: 's2', startBeat: 16, endBeat: 32, index: 1 },
        ]);

        expect(writtenSections()).toEqual([
            { id: 's1', startBeat: 0, endBeat: 16 },
            { id: 's2', startBeat: 16, endBeat: 32 },
        ]);
    });

    it('keeps both sections in place with their beats restored when an intervening section refuses the recorded pair', () => {
        // The review's shape: the reorder of [s1@0, s2@1] recorded this
        // inverse, then an intervening edit left [s2, s3, s1]. s1's recorded
        // slot 0 is held by named s2, but s2 cannot vacate it — its own
        // recorded slot 1 is held by unnamed s3 — so no swap can close. Both
        // sections must keep their live positions and still get their beats
        // back; the old fallback instead overwrote s1's slot claim with s2's,
        // silently dropping s1's restore.
        mocks.markerStoreValue.value = {
            sections: [
                { id: 's2', startBeat: 0, endBeat: 16 },
                { id: 's3', startBeat: 16, endBeat: 32 },
                { id: 's1', startBeat: 32, endBeat: 48 },
            ],
        };

        restoreSectionBeats([
            { sectionId: 's1', startBeat: 0, endBeat: 16, index: 0 },
            { sectionId: 's2', startBeat: 16, endBeat: 32, index: 1 },
        ]);

        const sections = writtenSections();
        // Membership and order never change, and each section appears once.
        expect(sections.map((section) => section.id)).toEqual(['s2', 's3', 's1']);
        // Both recorded beat spans restore in place — the inverse's substance.
        expect(sections.find((section) => section.id === 's1')).toMatchObject({ startBeat: 0, endBeat: 16 });
        expect(sections.find((section) => section.id === 's2')).toMatchObject({ startBeat: 16, endBeat: 32 });
    });
});
