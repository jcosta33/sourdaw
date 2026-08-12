import { describe, it, expect, beforeEach } from 'vitest';

import { scratchPadStore, sanitizeScratchPadSections, type ScratchPadStoreState } from '../scratchPadStore';

function makeSection(id: string, order: number): ScratchPadStoreState['sections'][number] {
    return { id, startBeat: 0, endBeat: 4, name: `Section ${id}`, color: '#000', order };
}

// F6 — scratchPadStore used to be memory-only; an in-progress scratch-pad
// arrangement vanished on reload. Now backed by `createAutomergeStorage`, so
// this covers the decode contract hydration relies on.
describe('scratchPadStore', () => {
    beforeEach(() => {
        scratchPadStore.set({ sections: [] });
    });

    it('boots empty', () => {
        expect(scratchPadStore.value?.sections).toEqual([]);
    });

    it('stores and replaces sections', () => {
        scratchPadStore.set({ sections: [makeSection('a', 0)] });
        expect(scratchPadStore.value?.sections).toHaveLength(1);

        scratchPadStore.set({ sections: [makeSection('b', 0), makeSection('c', 1)] });
        expect(scratchPadStore.value?.sections.map((section) => section.id)).toEqual(['b', 'c']);
    });

    it('subscribers fire on set', () => {
        let called = false;
        const unsubscribe = scratchPadStore.subscribe(() => {
            called = true;
        });
        scratchPadStore.set({ sections: [makeSection('a', 0)] });
        expect(called).toBe(true);
        unsubscribe();
    });

    describe('sanitizeScratchPadSections', () => {
        it('keeps a well-formed persisted section', () => {
            const persisted = [makeSection('a', 0)];

            expect(sanitizeScratchPadSections(persisted)).toEqual(persisted);
        });

        it('drops rows that do not decode and keeps the ones that do', () => {
            const decoded = sanitizeScratchPadSections([
                { id: '', startBeat: 0, endBeat: 4, name: 'No id', color: '#000', order: 0 },
                { id: 's-bad-order', startBeat: 0, endBeat: 4, name: 'Bad order', color: '#000', order: Number.NaN },
                makeSection('s-ok', 0),
                { ...makeSection('s-ok', 1), name: 'Duplicate' },
            ]);

            expect(decoded.map((section) => section.id)).toEqual(['s-ok']);
        });

        it('decodes a non-array to no sections', () => {
            expect(sanitizeScratchPadSections(undefined)).toEqual([]);
        });
    });
});
