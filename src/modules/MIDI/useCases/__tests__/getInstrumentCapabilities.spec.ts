import { beforeEach, describe, expect, it } from 'vitest';

import { getInstrumentCapabilities } from '../getInstrumentCapabilities';
import { instrumentCapabilitiesState } from '../instrumentCapabilitiesState';
import { registerInstrumentCapabilities } from '../registerInstrumentCapabilities';

function registerKnownInstrument(): void {
    registerInstrumentCapabilities({
        schemaVersion: 1,
        instrumentId: 'known-instrument',
        semanticsRevision: 3,
        expressionLanes: [
            {
                laneId: 'pitch',
                support: 'unavailable',
                reasonCode: 'instrument.unsupported',
            },
            {
                laneId: 'pressure',
                support: 'unavailable',
                reasonCode: 'instrument.unsupported',
            },
            {
                laneId: 'timbre',
                support: 'unavailable',
                reasonCode: 'instrument.unsupported',
            },
        ],
        tuningModel: 'fixed-equal-temperament',
        channelModel: 'single-channel',
        mpe: {
            zone: 'none',
            memberChannels: 0,
            maxVoices: 0,
        },
        articulationSwitching: 'none',
        drumMap: 'none',
        expressionTier: 'none',
    });
}

describe('getInstrumentCapabilities', () => {
    beforeEach(() => {
        instrumentCapabilitiesState.resetForTests();
    });

    it('returns fresh immutable registered snapshots for a known instrument', () => {
        registerKnownInstrument();

        const first = getInstrumentCapabilities('known-instrument');
        const second = getInstrumentCapabilities('known-instrument');

        expect(first).toMatchObject({
            availability: 'registered',
            instrumentId: 'known-instrument',
            semanticsRevision: 3,
        });
        expect(first).not.toBe(second);
        expect(first.expressionLanes).not.toBe(second.expressionLanes);
        expect(first.mpe).not.toBe(second.mpe);
        expect(Reflect.set(first, 'semanticsRevision', 99)).toBe(false);
        expect(Reflect.set(first.mpe, 'maxVoices', 9)).toBe(false);
        expect(getInstrumentCapabilities('known-instrument').semanticsRevision).toBe(3);
    });

    it.each(['external:plugin', 'unknown-legacy-id', '', ' future-id '])(
        'returns one silent generic projection for %j',
        (instrumentId) => {
            const result = getInstrumentCapabilities(instrumentId);

            expect(result).toEqual({
                availability: 'unavailable',
                unavailableReason: 'unknown-or-incompatible',
                schemaVersion: 1,
                instrumentId,
                semanticsRevision: 0,
                expressionLanes: [],
                tuningModel: 'unavailable',
                channelModel: 'unavailable',
                mpe: {
                    zone: 'none',
                    memberChannels: 0,
                    maxVoices: 0,
                },
                articulationSwitching: 'none',
                drumMap: 'none',
                expressionTier: 'none',
            });
            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.isFrozen(result.expressionLanes)).toBe(true);
            expect(Object.isFrozen(result.mpe)).toBe(true);
            expect(instrumentCapabilitiesState.read(instrumentId)).toBeUndefined();
        }
    );

    it('does not partially interpret a future descriptor schema', () => {
        instrumentCapabilitiesState.seedForTests({
            instrumentId: 'future-instrument',
            schemaVersion: 2,
            descriptor: {
                schemaVersion: 2,
                instrumentId: 'future-instrument',
                capabilities: ['everything'],
            },
        });

        expect(getInstrumentCapabilities('future-instrument')).toMatchObject({
            availability: 'unavailable',
            unavailableReason: 'unknown-or-incompatible',
            instrumentId: 'future-instrument',
            semanticsRevision: 0,
        });
    });

    it('fails closed when private registry state is malformed', () => {
        instrumentCapabilitiesState.seedForTests({
            instrumentId: 'malformed-instrument',
            schemaVersion: 1,
            descriptor: {
                availability: 'registered',
                schemaVersion: 1,
                instrumentId: 'malformed-instrument',
            },
        });

        expect(getInstrumentCapabilities('malformed-instrument')).toMatchObject({
            availability: 'unavailable',
            unavailableReason: 'unknown-or-incompatible',
            instrumentId: 'malformed-instrument',
        });
    });
});
