import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { changesTempo, changesTempoByActionType } from '../ChangesTempoByActionType';

describe('changesTempoByActionType', () => {
    it('marks exactly the actions that rewrite the tempo map', () => {
        const marked = Object.entries(changesTempoByActionType)
            .filter(([, changesTempoMap]) => changesTempoMap)
            .map(([type]) => type);

        expect(marked.toSorted()).toEqual([
            'deleteTime',
            'duplicateTimeRange',
            'editTempoMap',
            'insertTime',
            'restoreTempoEdit',
            'restoreTempoMapEdit',
            'restoreTimeOperationState',
            'setTempo',
        ]);
    });

    it('answers false for detectTempo, which reads audio and writes no tempo', () => {
        expect(changesTempo('detectTempo')).toBe(false);
    });

    it('answers false for an inherited name read from untrusted JSON', () => {
        const parsed: Pick<AppAction, 'type'> = JSON.parse('{"type":"constructor"}');

        expect(changesTempo(parsed.type)).toBe(false);
    });
});
