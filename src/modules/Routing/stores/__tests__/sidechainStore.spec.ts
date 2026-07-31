import { describe, expect, it } from 'vitest';

import { defaultSidechainStoreState, sanitize_sidechain_store_state } from '../sidechainStore';

describe('sanitize_sidechain_store_state', () => {
    it('should reset non-object persisted sidechain state', () => {
        expect(sanitize_sidechain_store_state('corrupt')).toEqual(defaultSidechainStoreState);
    });

    it('should preserve valid routes while dropping malformed rows', () => {
        const valid_route = {
            id: 'sidechain-1',
            sourceTrackId: 'track-1',
            targetTrackId: 'track-2',
            targetDeviceId: 'device-1',
            targetParameterId: 'threshold',
            gain: 0.75,
        };

        expect(
            sanitize_sidechain_store_state({
                routes: [
                    valid_route,
                    { ...valid_route, id: 'bad-gain', gain: Number.NaN },
                    { ...valid_route, id: 'bad-source', sourceTrackId: null },
                ],
            })
        ).toEqual({ routes: [valid_route] });
    });

    it('should strip unknown fields from valid routes', () => {
        expect(
            sanitize_sidechain_store_state({
                routes: [
                    {
                        id: 'sidechain-1',
                        sourceTrackId: 'track-1',
                        targetTrackId: 'track-2',
                        targetDeviceId: 'device-1',
                        targetParameterId: 'threshold',
                        gain: 1,
                        stale: true,
                    },
                ],
                stale: true,
            })
        ).toEqual({
            routes: [
                {
                    id: 'sidechain-1',
                    sourceTrackId: 'track-1',
                    targetTrackId: 'track-2',
                    targetDeviceId: 'device-1',
                    targetParameterId: 'threshold',
                    gain: 1,
                },
            ],
        });
    });

    it('should reset state when routes is present but not an array', () => {
        expect(sanitize_sidechain_store_state({ routes: 'not-an-array' })).toEqual(defaultSidechainStoreState);
    });

    it('deterministically quarantines concurrent duplicate IDs and source-device keys', () => {
        const preferred = {
            id: 'route-1',
            sourceTrackId: 'source-a',
            targetTrackId: 'target-a',
            targetDeviceId: 'device-a',
            targetParameterId: 'threshold',
            gain: 0.5,
        };
        const duplicateId = {
            ...preferred,
            sourceTrackId: 'source-b',
            targetTrackId: 'target-b',
            targetDeviceId: 'device-b',
        };
        const duplicateRuntimeKey = {
            ...preferred,
            id: 'route-2',
            targetTrackId: 'target-c',
            gain: 1,
        };
        const independent = {
            ...preferred,
            id: 'route-3',
            sourceTrackId: 'source-c',
            targetTrackId: 'target-c',
            targetDeviceId: 'device-c',
        };

        const firstProjection = sanitize_sidechain_store_state({
            routes: [duplicateId, independent, duplicateRuntimeKey, preferred],
        });
        const secondProjection = sanitize_sidechain_store_state({
            routes: [preferred, duplicateRuntimeKey, duplicateId, independent],
        });

        expect(firstProjection).toEqual({ routes: [preferred, independent] });
        expect(secondProjection).toEqual(firstProjection);
    });

    it('should return the same reference when the state is already exact', () => {
        const exact_state = {
            routes: [
                {
                    id: 'sidechain-1',
                    sourceTrackId: 'track-1',
                    targetTrackId: 'track-2',
                    targetDeviceId: 'device-1',
                    targetParameterId: 'threshold',
                    gain: 0.5,
                },
            ],
        };

        expect(sanitize_sidechain_store_state(exact_state)).toBe(exact_state);
    });
});
