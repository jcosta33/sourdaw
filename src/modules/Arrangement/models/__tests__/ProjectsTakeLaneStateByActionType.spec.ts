import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { projectsTakeLaneState, projectsTakeLaneStateByActionType } from '../ProjectsTakeLaneStateByActionType';

describe('projectsTakeLaneStateByActionType', () => {
    it('marks exactly the actions that change take-lane state', () => {
        const marked = Object.entries(projectsTakeLaneStateByActionType)
            .filter(([, value]) => value)
            .map(([type]) => type);

        expect(marked.toSorted()).toEqual([
            'removeCompRegion',
            'removeTrack',
            'replaceOriginalMidiTakeRow',
            'restoreCompRegionInterval',
            'restoreTrack',
            'selectTake',
            'setCompRegion',
        ]);
    });

    it('answers false for an inherited name read from untrusted JSON', () => {
        const parsed: Pick<AppAction, 'type'> = JSON.parse('{"type":"constructor"}');

        expect(projectsTakeLaneState(parsed.type)).toBe(false);
    });
});
