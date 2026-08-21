import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type ArrangementSection } from '../../../models/Marker';
import { type ScratchPadSection } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';
import { handleClearScratchPad } from '../handleClearScratchPad';
import { handleCommitScratchPad } from '../handleCommitScratchPad';
import { handleRestoreScratchPadState } from '../handleRestoreScratchPadState';

type RestoreScratchPadStateAction = Extract<AppAction, { type: 'restoreScratchPadState' }>;

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

describe('Arrangement scratch pad handlers', () => {
    beforeEach(resetStores);
    afterEach(resetStores);

    describe('handleClearScratchPad', () => {
        it('is undoable', () => {
            expect(handleClearScratchPad.undoable).toBe(true);
        });

        it('clears the pad through Arrangement', () => {
            scratchPadStore.set({ sections: [padSection('a', 0)] });

            handleClearScratchPad.execute({ type: 'clearScratchPad' });

            expect(scratchPadStore.value?.sections).toEqual([]);
        });

        it('describe captures the live pad and markers; the guarded restore undoes and redoes it exactly', () => {
            const liveSections = [padSection('a', 0), padSection('b', 1)];
            const liveMarkerSections = [markerSection('m1', 0)];
            scratchPadStore.set({ sections: liveSections });
            markerStore.set({ markers: [], sections: liveMarkerSections });

            const described = handleClearScratchPad.describe({ type: 'clearScratchPad' });
            handleClearScratchPad.execute({ type: 'clearScratchPad' });
            expect(scratchPadStore.value?.sections).toEqual([]);

            expect(described.inverseAction).toEqual({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: [],
                    replacementSections: liveSections,
                    expectedMarkerSections: liveMarkerSections,
                    replacementMarkerSections: liveMarkerSections,
                },
            });
            expect(described.redoAction).toEqual({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: liveSections,
                    replacementSections: [],
                    expectedMarkerSections: liveMarkerSections,
                    replacementMarkerSections: liveMarkerSections,
                },
            });

            // Undo: the guarded restore puts the captured pad back.
            const undoResult = handleRestoreScratchPadState.execute(
                described.inverseAction as RestoreScratchPadStateAction
            );
            expect(undoResult).toEqual({ status: 'written' });
            expect(scratchPadStore.value?.sections).toEqual(liveSections);

            // Redo: the guarded restore empties it again.
            const redoResult = handleRestoreScratchPadState.execute(
                described.redoAction as RestoreScratchPadStateAction
            );
            expect(redoResult).toEqual({ status: 'written' });
            expect(scratchPadStore.value?.sections).toEqual([]);
        });

        it('isNoop is true when the pad is already empty', () => {
            scratchPadStore.set({ sections: [] });
            expect(handleClearScratchPad.isNoop!({ type: 'clearScratchPad' })).toBe(true);
        });

        it('isNoop is false when the pad has sections', () => {
            scratchPadStore.set({ sections: [padSection('a', 0)] });
            expect(handleClearScratchPad.isNoop!({ type: 'clearScratchPad' })).toBe(false);
        });
    });

    describe('handleCommitScratchPad', () => {
        it('is undoable', () => {
            expect(handleCommitScratchPad.undoable).toBe(true);
        });

        it('commits the pad to the arrangement through Arrangement', () => {
            scratchPadStore.set({ sections: [padSection('a', 0)] });

            handleCommitScratchPad.execute({ type: 'commitScratchPad' });

            expect(markerStore.value?.sections.length).toBe(1);
            expect(markerStore.value?.sections[0]?.name).toBe('Pad a');
        });

        it('inverse carries the pre-commit markers; redo carries the ids the commit actually minted', () => {
            const padSections = [padSection('a', 0)];
            const previousMarkerSections = [markerSection('m1', 0)];
            scratchPadStore.set({ sections: padSections });
            markerStore.set({ markers: [], sections: previousMarkerSections });

            const action = { type: 'commitScratchPad' as const };
            const described = handleCommitScratchPad.describe(action);
            handleCommitScratchPad.execute(action);

            const mintedSections = markerStore.value?.sections ?? [];
            expect(mintedSections).toHaveLength(1);
            // Minted ids are namespaced away from both the pad and the pre-commit markers.
            expect(mintedSections[0]?.id).not.toBe(padSections[0]?.id);
            expect(mintedSections[0]?.id).not.toBe(previousMarkerSections[0]?.id);
            expect(mintedSections[0]?.id.startsWith('section-committed-')).toBe(true);

            const inverse = described.inverseAction;
            const redo = described.redoAction;
            expect(inverse).toEqual({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: padSections,
                    replacementSections: padSections,
                    expectedMarkerSections: mintedSections,
                    replacementMarkerSections: previousMarkerSections,
                },
            });
            expect(redo).toEqual({
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: padSections,
                    replacementSections: padSections,
                    expectedMarkerSections: previousMarkerSections,
                    replacementMarkerSections: mintedSections,
                },
            });
        });

        it('the guarded restore actually undoes and redoes a commit end to end', () => {
            const padSections = [padSection('a', 0)];
            const previousMarkerSections = [markerSection('m1', 0)];
            scratchPadStore.set({ sections: padSections });
            markerStore.set({ markers: [], sections: previousMarkerSections });

            const action = { type: 'commitScratchPad' as const };
            const described = handleCommitScratchPad.describe(action);
            handleCommitScratchPad.execute(action);
            const mintedSections = markerStore.value?.sections ?? [];

            const undoResult = handleRestoreScratchPadState.execute(
                described.inverseAction as RestoreScratchPadStateAction
            );
            expect(undoResult).toEqual({ status: 'written' });
            expect(markerStore.value?.sections).toEqual(previousMarkerSections);

            const redoResult = handleRestoreScratchPadState.execute(
                described.redoAction as RestoreScratchPadStateAction
            );
            expect(redoResult).toEqual({ status: 'written' });
            expect(markerStore.value?.sections).toEqual(mintedSections);
        });

        it('describe returns a null inverse when there is nothing to commit', () => {
            scratchPadStore.set({ sections: [] });

            const described = handleCommitScratchPad.describe({ type: 'commitScratchPad' });

            expect(described.inverseAction).toBeNull();
        });

        it('isNoop is true when the pad has no sections', () => {
            scratchPadStore.set({ sections: [] });
            expect(handleCommitScratchPad.isNoop!({ type: 'commitScratchPad' })).toBe(true);
        });

        it('isNoop is true when the marker store holds no state', () => {
            scratchPadStore.set({ sections: [padSection('a', 0)] });
            markerStore.clear();
            expect(handleCommitScratchPad.isNoop!({ type: 'commitScratchPad' })).toBe(true);
        });

        it('isNoop is false when there is something to commit', () => {
            scratchPadStore.set({ sections: [padSection('a', 0)] });
            expect(handleCommitScratchPad.isNoop!({ type: 'commitScratchPad' })).toBe(false);
        });

        it('execute is a no-op write when there is nothing to commit', () => {
            scratchPadStore.set({ sections: [] });
            const result = handleCommitScratchPad.execute({ type: 'commitScratchPad' });
            expect(result).toEqual({ status: 'no-write' });
        });
    });
});
