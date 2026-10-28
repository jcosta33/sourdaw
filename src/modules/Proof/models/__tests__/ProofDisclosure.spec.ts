import { describe, expect, it } from 'vitest';

import { proofDisclosureLevelFromState } from '../ProofDisclosure';

describe('Proof saved disclosure', () => {
    it.each([1, 2, 3, 4, 5] as const)('maps legacy numeric level %s without mutating its chunk', (level) => {
        const state = Object.freeze({ version: 1, data: Object.freeze({ uiLevel: level }) });
        expect(proofDisclosureLevelFromState(state)).toBe(level);
    });
    it.each(['play', 'shape', 'build', 'route', 'lab'])('reads named tier %s before a legacy level', (tier) => {
        expect(proofDisclosureLevelFromState({ version: 1, data: { disclosureTier: tier, uiLevel: 5 } })).toBe(
            ['play', 'shape', 'build', 'route', 'lab'].indexOf(tier) + 1
        );
    });
    it.each([
        undefined,
        null,
        [],
        {},
        { version: 99, data: { disclosureTier: 'lab' } },
        { version: 1, data: null },
        { version: 1, data: { uiLevel: 6 } },
        { version: 1, data: { uiLevel: -1 } },
        { version: 1, data: { uiLevel: 2.5 } },
        { version: 1, data: { uiLevel: '5' } },
        { version: 1, data: { disclosureTier: 'unknown' } },
    ])('defaults malformed or newer chunks to Play: %j', (state) => {
        expect(proofDisclosureLevelFromState(state)).toBe(1);
    });
});
