import { describe, expect, it } from 'vitest';

import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';

describe('getPlannedActionAffectedIds', () => {
    it('names no ids for an action type that states none', () => {
        expect(getPlannedActionAffectedIds({ type: 'togglePlayback' })).toEqual([]);
    });

    it('lists ids a command names ahead of its static authority before the ones it names after', () => {
        expect(
            getPlannedActionAffectedIds({
                type: 'automateParameterRange',
                payload: {
                    trackId: 'track-a',
                    parameterId: 'device-1:param',
                    value: 0.5,
                    range: { startBeat: 0, endBeat: 4 },
                },
            })
        ).toEqual(expect.arrayContaining(['device-1']));
        expect(getPlannedActionAffectedIds({ type: 'createBus', payload: { busId: 'bus-1', name: 'Bus' } })).toContain(
            'bus-1'
        );
    });
});
