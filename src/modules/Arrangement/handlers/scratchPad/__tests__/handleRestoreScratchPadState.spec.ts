import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ArrangementSection } from '../../../models/Marker';
import { type ScratchPadSection } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';
import { handleRestoreScratchPadState } from '../handleRestoreScratchPadState';

function padSection(id: string, order: number): ScratchPadSection {
    return { id, startBeat: order * 4, endBeat: order * 4 + 4, name: `Pad ${id}`, color: '#111111', order };
}

function markerSection(id: string, startBeat: number): ArrangementSection {
    return { id, startBeat, endBeat: startBeat + 4, name: `Section ${id}`, color: '#222222' };
}

function resetStores(): void {
    scratchPadStore.set({ sections: [] });
    markerStore.set({ markers: [], sections: [] });
}

describe('handleRestoreScratchPadState', () => {
    beforeEach(resetStores);
    afterEach(resetStores);

    it('is undoable: false — invoked only by undo machinery, never records its own entry', () => {
        expect(handleRestoreScratchPadState.undoable).toBe(false);
    });

    it('describes a null inverse', () => {
        const result = handleRestoreScratchPadState.describe({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [],
                replacementSections: [],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });
        expect(result.inverseAction).toBeNull();
    });

    it('writes both replacement collections when live state matches the expected id sequence', () => {
        const liveSections = [padSection('a', 0), padSection('b', 1)];
        const liveMarkerSections = [markerSection('m1', 0)];
        scratchPadStore.set({ sections: liveSections });
        markerStore.set({ markers: [], sections: liveMarkerSections });

        const replacementSections = [padSection('c', 0)];
        const replacementMarkerSections = [markerSection('m2', 8)];

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: liveSections,
                replacementSections,
                expectedMarkerSections: liveMarkerSections,
                replacementMarkerSections,
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(scratchPadStore.value?.sections).toEqual(replacementSections);
        expect(markerStore.value?.sections).toEqual(replacementMarkerSections);
    });

    it('returns conflict and writes nothing when a pad section was added between capture and restore', () => {
        const expectedSections = [padSection('a', 0)];
        const liveSections = [padSection('a', 0), padSection('added-since', 1)];
        const liveMarkerSections = [markerSection('m1', 0)];
        scratchPadStore.set({ sections: liveSections });
        markerStore.set({ markers: [], sections: liveMarkerSections });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections,
                replacementSections: [padSection('replacement', 0)],
                expectedMarkerSections: liveMarkerSections,
                replacementMarkerSections: [markerSection('replacement-marker', 0)],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual(liveSections);
        expect(markerStore.value?.sections).toEqual(liveMarkerSections);
    });

    it('returns conflict and writes nothing when pad sections were reordered between capture and restore', () => {
        const expectedSections = [padSection('a', 0), padSection('b', 1)];
        const liveSections = [padSection('b', 1), padSection('a', 0)];
        scratchPadStore.set({ sections: liveSections });
        markerStore.set({ markers: [], sections: [] });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections,
                replacementSections: [padSection('replacement', 0)],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual(liveSections);
    });

    it('returns conflict and writes nothing when a marker section diverged, even if the pad side matches', () => {
        const liveSections = [padSection('a', 0)];
        const expectedMarkerSections = [markerSection('m1', 0)];
        const liveMarkerSections = [markerSection('m1', 0), markerSection('added-since', 8)];
        scratchPadStore.set({ sections: liveSections });
        markerStore.set({ markers: [], sections: liveMarkerSections });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: liveSections,
                replacementSections: [padSection('replacement', 0)],
                expectedMarkerSections,
                replacementMarkerSections: [markerSection('replacement-marker', 0)],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual(liveSections);
        expect(markerStore.value?.sections).toEqual(liveMarkerSections);
    });

    it('returns conflict and writes nothing when a replacement pad section carries only its id', () => {
        const liveMarkerSections = [markerSection('m1', 0)];
        markerStore.set({ markers: [], sections: liveMarkerSections });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [],
                replacementSections: [padSection('whole', 0), { id: 'bare' }],
                expectedMarkerSections: liveMarkerSections,
                replacementMarkerSections: liveMarkerSections,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual([]);
        expect(markerStore.value?.sections).toEqual(liveMarkerSections);
    });

    it('returns conflict and writes nothing when a replacement marker section carries only its id', () => {
        const liveMarkerSections = [markerSection('m1', 0)];
        markerStore.set({ markers: [], sections: liveMarkerSections });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [],
                replacementSections: [padSection('whole', 0)],
                expectedMarkerSections: liveMarkerSections,
                replacementMarkerSections: [markerSection('m2', 8), { id: 'bare-marker' }],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual([]);
        expect(markerStore.value?.sections).toEqual(liveMarkerSections);
    });

    it('returns conflict and writes nothing when the live pad keeps the expected ids but a field was edited since', () => {
        const expected = padSection('a', 0);
        const live = { ...expected, name: 'Edited since' };
        scratchPadStore.set({ sections: [live] });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [expected],
                replacementSections: [padSection('replacement', 0)],
                expectedMarkerSections: [],
                replacementMarkerSections: [],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual([live]);
    });

    it('returns conflict and writes nothing when a marker-writing restore finds other marker ids than expected', () => {
        const liveMarkerSections = [markerSection('m2', 0)];
        markerStore.set({ markers: [], sections: liveMarkerSections });

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [],
                replacementSections: [padSection('replacement', 0)],
                expectedMarkerSections: [markerSection('m1', 0)],
                replacementMarkerSections: [markerSection('m3', 0)],
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(scratchPadStore.value?.sections).toEqual([]);
        expect(markerStore.value?.sections).toEqual(liveMarkerSections);
    });

    it('neither guards nor writes markers when the restore carries equal marker snapshots', () => {
        const liveMarkerSections = [markerSection('m-live', 0)];
        markerStore.set({ markers: [], sections: liveMarkerSections });
        const snapshot = [markerSection('m-captured', 0)];

        const result = handleRestoreScratchPadState.execute({
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: [],
                replacementSections: [padSection('a', 0)],
                expectedMarkerSections: snapshot,
                replacementMarkerSections: snapshot,
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(scratchPadStore.value?.sections).toEqual([padSection('a', 0)]);
        expect(markerStore.value?.sections).toEqual(liveMarkerSections);
    });

    it('isNoop is true when both replacement collections already match live state', () => {
        const sections = [padSection('a', 0)];
        const markerSections = [markerSection('m1', 0)];
        scratchPadStore.set({ sections });
        markerStore.set({ markers: [], sections: markerSections });

        expect(
            handleRestoreScratchPadState.isNoop!({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: [],
                    replacementSections: sections,
                    expectedMarkerSections: [],
                    replacementMarkerSections: markerSections,
                },
            })
        ).toBe(true);
    });

    it.each([
        { field: 'name', changed: { name: 'Renamed' } },
        { field: 'color', changed: { color: '#ffffff' } },
        { field: 'startBeat', changed: { startBeat: 2 } },
        { field: 'endBeat', changed: { endBeat: 12 } },
        { field: 'order', changed: { order: 5 } },
    ])('isNoop is false when only the pad section $field differs from live state', ({ changed }) => {
        const live = padSection('a', 0);
        scratchPadStore.set({ sections: [live] });
        markerStore.set({ markers: [], sections: [] });

        expect(
            handleRestoreScratchPadState.isNoop!({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: [live],
                    replacementSections: [{ ...live, ...changed }],
                    expectedMarkerSections: [],
                    replacementMarkerSections: [],
                },
            })
        ).toBe(false);
    });

    it('isNoop is false when only a marker section field differs from live state', () => {
        const liveMarker = markerSection('m1', 0);
        const renamedMarker: ArrangementSection = { ...liveMarker, name: 'Renamed' };
        scratchPadStore.set({ sections: [] });
        markerStore.set({ markers: [], sections: [liveMarker] });

        expect(
            handleRestoreScratchPadState.isNoop!({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: [],
                    replacementSections: [],
                    expectedMarkerSections: [liveMarker],
                    replacementMarkerSections: [renamedMarker],
                },
            })
        ).toBe(false);
    });

    it('isNoop is false when the replacement pad sections differ from live state', () => {
        scratchPadStore.set({ sections: [padSection('a', 0)] });
        markerStore.set({ markers: [], sections: [] });

        expect(
            handleRestoreScratchPadState.isNoop!({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: [],
                    replacementSections: [padSection('b', 0)],
                    expectedMarkerSections: [],
                    replacementMarkerSections: [],
                },
            })
        ).toBe(false);
    });
});
