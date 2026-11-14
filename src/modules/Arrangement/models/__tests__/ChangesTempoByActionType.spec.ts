import { describe, expect, it } from 'vitest';

import { changesTempoByActionType } from '../ChangesTempoByActionType';

describe('changesTempoByActionType', () => {
    it('marks exactly the two tempo edits', () => {
        const tempoEdits = Object.entries(changesTempoByActionType)
            .filter(([, changesTempo]) => changesTempo)
            .map(([type]) => type);

        expect(tempoEdits.toSorted()).toEqual(['restoreTempoEdit', 'setTempo']);
    });

    it('answers false for an action that does not edit the tempo', () => {
        expect(changesTempoByActionType.togglePlayback).toBe(false);
    });
});
