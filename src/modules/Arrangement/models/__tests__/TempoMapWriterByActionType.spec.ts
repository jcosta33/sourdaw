import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { rewritesTempoMap, tempoMapWriterByActionType } from '../TempoMapWriterByActionType';

describe('tempoMapWriterByActionType', () => {
    it('marks exactly the actions that rewrite the tempo map', () => {
        const marked = Object.entries(tempoMapWriterByActionType)
            .filter(([, value]) => value)
            .map(([type]) => type);

        expect(marked.toSorted()).toEqual([
            'deleteTime',
            'detectTempo',
            'duplicateTimeRange',
            'editTempoMap',
            'insertTime',
            'restoreTempoEdit',
            'restoreTempoMapEdit',
            'restoreTimeOperationState',
            'setTempo',
        ]);
    });

    it('answers false for an inherited name read from untrusted JSON', () => {
        const parsed: Pick<AppAction, 'type'> = JSON.parse('{"type":"constructor"}');

        expect(rewritesTempoMap(parsed.type)).toBe(false);
    });
});
