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
});
