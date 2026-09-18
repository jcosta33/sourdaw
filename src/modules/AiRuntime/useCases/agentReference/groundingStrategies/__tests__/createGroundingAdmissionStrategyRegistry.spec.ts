import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { createGroundingAdmissionStrategyRegistry } from '../createGroundingAdmissionStrategyRegistry';

const label = 'pre-scope admission';

describe('createGroundingAdmissionStrategyRegistry', () => {
    it('rejects duplicate registrations under the supplied label', () => {
        expect(() =>
            createGroundingAdmissionStrategyRegistry<'muteTrack', { prompt: string }>(
                label,
                [
                    { name: 'muteTrack', transform: () => null },
                    { name: 'muteTrack', transform: () => null },
                ],
                getExecutableAppActionGroundingCatalog(),
                ['muteTrack']
            )
        ).toThrow('Duplicate pre-scope admission strategy: muteTrack');
    });

    it('rejects a registered strategy missing from the canonical command grounding catalog', () => {
        expect(() =>
            createGroundingAdmissionStrategyRegistry<'muteTrack', { prompt: string }>(
                label,
                [{ name: 'muteTrack', transform: () => null }],
                [],
                ['muteTrack']
            )
        ).toThrow('Pre-scope admission strategy is not a canonical executable action: muteTrack');
    });

    it('rejects a missing expected strategy definition', () => {
        expect(() =>
            createGroundingAdmissionStrategyRegistry<'muteTrack' | 'soloTrack', { prompt: string }>(
                label,
                [{ name: 'muteTrack', transform: () => null }],
                getExecutableAppActionGroundingCatalog(),
                ['muteTrack', 'soloTrack']
            )
        ).toThrow('Missing pre-scope admission strategy: soloTrack');
    });

    it('returns a registry keyed by every registered strategy name', () => {
        const registry = createGroundingAdmissionStrategyRegistry<'muteTrack' | 'soloTrack', { prompt: string }>(
            label,
            [
                { name: 'muteTrack', transform: ({ prompt }) => prompt },
                { name: 'soloTrack', transform: () => null },
            ],
            getExecutableAppActionGroundingCatalog(),
            ['muteTrack', 'soloTrack']
        );

        expect([...registry.keys()]).toEqual(['muteTrack', 'soloTrack']);
        expect(registry.get('muteTrack')?.({ prompt: 'mute everything' })).toBe('mute everything');
    });
});
