import { describe, expect, it } from 'vitest';

import { undoEntryStoresCommandIdByActionType } from '../UndoEntryCommandIdPolicy';

describe('undoEntryStoresCommandIdByActionType', () => {
    it('marks exactly the removal and split of a clip as storing the command id', () => {
        const storing = Object.entries(undoEntryStoresCommandIdByActionType)
            .filter(([, stores]) => stores)
            .map(([type]) => type);

        expect(storing.toSorted()).toEqual(['removeClip', 'splitClip']);
    });

    it('answers false for an action whose undo entry carries no command id', () => {
        expect(undoEntryStoresCommandIdByActionType.setTrackGain).toBe(false);
    });
});
