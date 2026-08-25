import { describe, expect, it } from 'vitest';

import { getAppActionStaticAuthority } from '../getAppActionStaticAuthority';

describe('getAppActionStaticAuthority', () => {
    it('returns the exact registered many-target track IDs', () => {
        expect(
            getAppActionStaticAuthority({
                type: 'automateTrackGainRange',
                payload: { trackIds: ['bus-drums', 'bus-bass'], sectionName: 'Chorus 2', gainDb: 1.5 },
            })
        ).toEqual(['bus-drums', 'bus-bass']);
    });

    it('returns the exact source array and batch-local destination bus in registry order', () => {
        expect(
            getAppActionStaticAuthority({
                type: 'automateSendRanges',
                payload: {
                    trackIds: ['track-bgv-1', 'track-bgv-2'],
                    busId: 'bus-vocal-plate',
                    sectionIds: ['section-chorus-1'],
                    tailBars: 4,
                    targetLevelDb: -12,
                },
            })
        ).toEqual(['track-bgv-1', 'track-bgv-2', 'bus-vocal-plate']);
    });

    it('returns the exact adjustment-layer target without unrelated section or track evidence', () => {
        expect(
            getAppActionStaticAuthority({
                type: 'addAdjustmentRegion',
                payload: {
                    layerId: 'layer-bass-air',
                    startBeat: 16,
                    endBeat: 32,
                    targetSection: { id: 'section-chorus', name: 'Chorus', startBeat: 16, endBeat: 32 },
                    expectedTracks: [{ trackId: 'track-bass', trackName: 'Bass', frozen: false }],
                },
            })
        ).toEqual(['layer-bass-air']);
    });
});
