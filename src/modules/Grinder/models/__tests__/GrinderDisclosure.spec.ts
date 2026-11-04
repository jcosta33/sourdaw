import { describe, expect, it } from 'vitest';

import { EFFECT_DISCLOSURE_TIERS } from '#/utils/UI/effectDisclosureTier';

import { grinderDisclosureLevelFromState, grinderVisibleSection } from '../GrinderDisclosure';

describe('Grinder saved disclosure', () => {
    it.each([
        ['browse', 0],
        ['amp', 1],
        ['drive', 2],
        ['cab', 3],
        ['neural', 3],
        ['lab', 4],
    ] as const)('keeps section %s cumulative above floor %s', (section, floor) => {
        for (const [index, tier] of EFFECT_DISCLOSURE_TIERS.entries()) {
            expect(grinderVisibleSection(section, tier)).toBe(index >= floor ? section : 'browse');
        }
    });
    it.each([1, 2, 3, 4, 5] as const)('maps legacy numeric level %s without mutating its chunk', (level) => {
        const state = Object.freeze({ version: 1, data: Object.freeze({ uiLevel: level }) });
        expect(grinderDisclosureLevelFromState(state)).toBe(level);
    });
    it.each(['play', 'shape', 'build', 'route', 'lab'])('reads named tier %s before a legacy level', (tier) => {
        expect(grinderDisclosureLevelFromState({ version: 1, data: { disclosureTier: tier, uiLevel: 5 } })).toBe(
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
        expect(grinderDisclosureLevelFromState(state)).toBe(1);
    });
});
