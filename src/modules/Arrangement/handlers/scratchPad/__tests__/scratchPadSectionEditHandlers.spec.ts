import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ScratchPadSection } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';
import { handleRemoveScratchPadSection } from '../handleRemoveScratchPadSection';
import { handleRenameScratchPadSection } from '../handleRenameScratchPadSection';
import { handleReorderScratchPadSection } from '../handleReorderScratchPadSection';
import { handleSetScratchPadSectionColor } from '../handleSetScratchPadSectionColor';

const FIRST: ScratchPadSection = { id: 'a', startBeat: 0, endBeat: 8, name: 'A', color: '#111111', order: 0 };
const SECOND: ScratchPadSection = { id: 'b', startBeat: 8, endBeat: 20, name: 'B', color: '#222222', order: 1 };

function resetStores(): void {
    scratchPadStore.set({ sections: [] });
    markerStore.set({ markers: [], sections: [] });
}

describe('scratch pad section edit handlers', () => {
    beforeEach(() => {
        resetStores();
        scratchPadStore.set({ sections: structuredClone([FIRST, SECOND]) });
    });
    afterEach(resetStores);

    it.each([
        { label: 'remove', handler: handleRemoveScratchPadSection },
        { label: 'rename', handler: handleRenameScratchPadSection },
        { label: 'reorder', handler: handleReorderScratchPadSection },
        { label: 'recolour', handler: handleSetScratchPadSectionColor },
    ])('$label is undoable', ({ handler }) => {
        expect(handler.undoable).toBe(true);
    });

    it('describes a remove whose inverse restores the captured pad from the produced pad', () => {
        const described = handleRemoveScratchPadSection.describe({
            type: 'removeScratchPadSection',
            payload: { sectionId: FIRST.id },
        });

        expect(described.inverseAction).toEqual({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [{ ...SECOND, order: 0 }],
                replacementSections: [FIRST, SECOND],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });
    });

    it('describes a rename whose expected pad carries the new name', () => {
        const described = handleRenameScratchPadSection.describe({
            type: 'renameScratchPadSection',
            payload: { sectionId: SECOND.id, name: 'Hook' },
        });

        expect(described.inverseAction).toEqual({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [FIRST, { ...SECOND, name: 'Hook' }],
                replacementSections: [FIRST, SECOND],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });
    });

    it('describes a reorder whose expected pad carries the reflowed beats', () => {
        const described = handleReorderScratchPadSection.describe({
            type: 'reorderScratchPadSection',
            payload: { sectionId: SECOND.id, direction: 'left' },
        });

        expect(described.inverseAction).toEqual({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [
                    { ...SECOND, startBeat: 0, endBeat: 12, order: 0 },
                    { ...FIRST, startBeat: 12, endBeat: 20, order: 1 },
                ],
                replacementSections: [FIRST, SECOND],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });
    });

    it('describes a recolour whose expected pad carries the new colour', () => {
        const described = handleSetScratchPadSectionColor.describe({
            type: 'setScratchPadSectionColor',
            payload: { sectionId: FIRST.id, color: '#ffffff' },
        });

        expect(described.inverseAction).toEqual({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [{ ...FIRST, color: '#ffffff' }, SECOND],
                replacementSections: [FIRST, SECOND],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });
    });

    it.each([
        {
            label: 'remove of an unknown section',
            isNoop: () =>
                handleRemoveScratchPadSection.isNoop!({
                    type: 'removeScratchPadSection',
                    payload: { sectionId: 'missing' },
                }),
            expected: true,
        },
        {
            label: 'remove of a known section',
            isNoop: () =>
                handleRemoveScratchPadSection.isNoop!({
                    type: 'removeScratchPadSection',
                    payload: { sectionId: FIRST.id },
                }),
            expected: false,
        },
        {
            label: 'rename of an unknown section',
            isNoop: () =>
                handleRenameScratchPadSection.isNoop!({
                    type: 'renameScratchPadSection',
                    payload: { sectionId: 'missing', name: 'X' },
                }),
            expected: true,
        },
        {
            label: 'rename to the same name',
            isNoop: () =>
                handleRenameScratchPadSection.isNoop!({
                    type: 'renameScratchPadSection',
                    payload: { sectionId: FIRST.id, name: FIRST.name },
                }),
            expected: true,
        },
        {
            label: 'rename to a new name',
            isNoop: () =>
                handleRenameScratchPadSection.isNoop!({
                    type: 'renameScratchPadSection',
                    payload: { sectionId: FIRST.id, name: 'New' },
                }),
            expected: false,
        },
        {
            label: 'reorder of an unknown section',
            isNoop: () =>
                handleReorderScratchPadSection.isNoop!({
                    type: 'reorderScratchPadSection',
                    payload: { sectionId: 'missing', direction: 'left' },
                }),
            expected: true,
        },
        {
            label: 'reorder left at the left edge',
            isNoop: () =>
                handleReorderScratchPadSection.isNoop!({
                    type: 'reorderScratchPadSection',
                    payload: { sectionId: FIRST.id, direction: 'left' },
                }),
            expected: true,
        },
        {
            label: 'reorder right at the right edge',
            isNoop: () =>
                handleReorderScratchPadSection.isNoop!({
                    type: 'reorderScratchPadSection',
                    payload: { sectionId: SECOND.id, direction: 'right' },
                }),
            expected: true,
        },
        {
            label: 'reorder away from an edge',
            isNoop: () =>
                handleReorderScratchPadSection.isNoop!({
                    type: 'reorderScratchPadSection',
                    payload: { sectionId: FIRST.id, direction: 'right' },
                }),
            expected: false,
        },
        {
            label: 'recolour of an unknown section',
            isNoop: () =>
                handleSetScratchPadSectionColor.isNoop!({
                    type: 'setScratchPadSectionColor',
                    payload: { sectionId: 'missing', color: '#ffffff' },
                }),
            expected: true,
        },
        {
            label: 'recolour to the colour already set',
            isNoop: () =>
                handleSetScratchPadSectionColor.isNoop!({
                    type: 'setScratchPadSectionColor',
                    payload: { sectionId: FIRST.id, color: FIRST.color },
                }),
            expected: true,
        },
        {
            label: 'recolour to a new colour',
            isNoop: () =>
                handleSetScratchPadSectionColor.isNoop!({
                    type: 'setScratchPadSectionColor',
                    payload: { sectionId: FIRST.id, color: '#ffffff' },
                }),
            expected: false,
        },
    ])('isNoop: $label is $expected', ({ isNoop, expected }) => {
        expect(isNoop()).toBe(expected);
    });
});
