import { getFactoryPresets, getUserPresets } from '#/modules/Arrangement/useCases';

import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

type SoundPresetRecord = ReturnType<typeof getFactoryPresets>[number];

function toPresetCandidate(preset: SoundPresetRecord): DiscoveryCandidate {
    return {
        kind: preset.category,
        entry: {
            id: preset.id,
            name: preset.name,
            domain: 'preset',
            availability: 'available',
            reason: null,
            // Presets carry no owner-published version; a composed one would be
            // this layer's invention rather than the library's.
            version: null,
            evidence: {
                source: 'sound-preset-library',
                category: preset.category,
                trackKind: preset.trackKind,
                isFactory: preset.isFactory,
            },
        },
    };
}

/** The sound preset library as the Arrangement module publishes it, factory and user alike. */
export function collectPresetDiscoveryEntries(): DiscoveryCandidate[] {
    return [...getFactoryPresets(), ...getUserPresets()].map(toPresetCandidate);
}
