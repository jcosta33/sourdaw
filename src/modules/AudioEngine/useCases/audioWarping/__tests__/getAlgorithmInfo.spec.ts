import { describe, expect, it } from 'vitest';

import { type WarpAlgorithm } from '#/modules/AudioEngine/stores/audioWarp';

import { getAlgorithmInfo } from '../getAlgorithmInfo';

const ALL_ALGORITHMS: WarpAlgorithm[] = [
    'elastique-pro',
    'elastique-efficient',
    'elastique-soloist',
    'rubber-band-r3',
    'rubber-band-rt',
    'complex',
    'complex-pro',
    'repitch',
    'slice',
];

describe('getAlgorithmInfo', () => {
    it('should expose non-empty metadata for every warp algorithm', () => {
        for (const algorithm of ALL_ALGORITHMS) {
            const info = getAlgorithmInfo(algorithm);
            expect(info.name.length, algorithm).toBeGreaterThan(0);
            expect(['high', 'medium', 'low']).toContain(info.quality);
            expect(['high', 'medium', 'low']).toContain(info.cpuCost);
            expect(info.bestFor.length).toBeGreaterThan(0);
            expect(typeof info.realTime).toBe('boolean');
        }
    });

    it('should return metadata for élastique Pro', () => {
        const info = getAlgorithmInfo('elastique-pro');
        expect(info.name).toContain('élastique');
        expect(info.quality).toBe('high');
        expect(info.realTime).toBe(true);
    });

    it('should mark Rubber Band R3 as offline-quality', () => {
        const info = getAlgorithmInfo('rubber-band-r3');
        expect(info.realTime).toBe(false);
        expect(info.cpuCost).toBe('high');
    });

    it('should cover repitch as low cost', () => {
        const info = getAlgorithmInfo('repitch');
        expect(info.quality).toBe('low');
        expect(info.cpuCost).toBe('low');
    });
});
