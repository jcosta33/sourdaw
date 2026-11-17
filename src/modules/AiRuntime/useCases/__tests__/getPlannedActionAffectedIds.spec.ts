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

    it('names the device an addDevice mints after the track it targets', () => {
        expect(
            getPlannedActionAffectedIds({
                type: 'addDevice',
                payload: { trackId: 'track-a', deviceType: 'eq', deviceId: 'device-1' },
            })
        ).toEqual(['track-a', 'device-1']);
    });

    it('names only the targeted track for an addDevice that leaves the device id to the handler', () => {
        expect(
            getPlannedActionAffectedIds({ type: 'addDevice', payload: { trackId: 'track-a', deviceType: 'eq' } })
        ).toEqual(['track-a']);
    });
});
