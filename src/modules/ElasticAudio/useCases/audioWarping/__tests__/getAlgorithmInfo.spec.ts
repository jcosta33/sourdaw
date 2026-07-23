import { describe, it, expect } from 'vitest';

import { getAlgorithmInfo } from '../getAlgorithmInfo';

describe('getAlgorithmInfo', () => {
    it('reports repitch as the only algorithm available today', () => {
        const info = getAlgorithmInfo('repitch');
        expect(info.name).toBe('Repitch');
        expect(info.available).toBe(true);
        expect(info.description.length).toBeGreaterThan(0);
    });

    it('marks the in-house engine modes as not yet available', () => {
        expect(getAlgorithmInfo('phase-vocoder').available).toBe(false);
        expect(getAlgorithmInfo('wsola').available).toBe(false);
    });

    it('names no third-party licensed engines', () => {
        const names = (['repitch', 'phase-vocoder', 'wsola'] as const).map((algorithm) =>
            getAlgorithmInfo(algorithm).name.toLowerCase()
        );
        for (const name of names) {
            expect(name).not.toMatch(/élastique|elastique|rubber\s*band/);
        }
    });
});
