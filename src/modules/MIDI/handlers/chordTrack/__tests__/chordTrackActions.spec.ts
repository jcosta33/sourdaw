import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { chordTrackStore, type ChordTrackState } from '../../../stores/chordTrackStore';
import { getChordTrackHandlers } from '../../../useCases/getChordTrackHandlers';

const beforeState: ChordTrackState = {
    enabled: true,
    events: [{ id: 'chord-a', beat: 4, root: 0, quality: 'major', duration: 2 }],
};

const mutationCases = [
    { type: 'addChordEvent', payload: { eventId: 'chord-c', beat: 2, root: 5, quality: 'minor', duration: 4 } },
    { type: 'moveChordEvent', payload: { eventId: 'chord-a', beat: 1 } },
    { type: 'updateChordEvent', payload: { eventId: 'chord-a', root: 14, quality: 'min9', duration: 0.1 } },
    { type: 'removeChordEvent', payload: { eventId: 'chord-a' } },
    { type: 'toggleChordTrack', payload: { enabled: false } },
    { type: 'clearChordTrack' },
] satisfies AppAction[];

describe('chord-track action authority', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getChordTrackHandlers());
        clearUndoHistory();
        chordTrackStore.set(structuredClone(beforeState));
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
    });

    it.each(mutationCases)('$type restores exact state on undo and redo', async (action) => {
        await executeAppAction(action);
        const expected = structuredClone(chordTrackStore.value);
        expect(expected).not.toEqual(beforeState);
        await undo();
        expect(chordTrackStore.value).toEqual(beforeState);
        await redo();
        expect(chordTrackStore.value).toEqual(expected);
    });

    it('labels the effective disabling toggle and skips explicit same-state toggles', async () => {
        await executeAppAction({ type: 'toggleChordTrack' });
        expect(undoStore.value?.past.at(-1)?.label).toBe('Disable chord track');

        const undoCount = undoStore.value?.past.length;
        await executeAppAction({ type: 'toggleChordTrack', payload: { enabled: false } });
        expect(undoStore.value?.past).toHaveLength(undoCount ?? 0);
    });
});
