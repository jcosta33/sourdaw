import { getAgentPresetDiscoveryManifest } from '#/modules/Arrangement/useCases';

import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

type SoundPresetRecord = ReturnType<typeof getAgentPresetDiscoveryManifest>[number];

function toPresetCandidate(preset: SoundPresetRecord): DiscoveryCandidate {
    return {
        kind: preset.category,
        searchTerms: preset.searchTerms,
        entry: {
            id: preset.id,
            name: preset.name,
            domain: 'preset',
            availability: 'available',
            reason: null,
            version: preset.version,
            evidence: {
                source: 'sound-preset-library',
                category: preset.category,
                subcategory: preset.subcategory,
                description: preset.description,
                trackKind: preset.trackKind,
                isFactory: preset.isFactory,
                tags: preset.tags,
                deviceTypes: preset.deviceTypes,
                metadata: preset.metadata,
            },
        },
    };
}

/** The sound preset library as the Arrangement module publishes it, factory and user alike. */
export function collectPresetDiscoveryEntries(): DiscoveryCandidate[] {
    return getAgentPresetDiscoveryManifest().map(toPresetCandidate);
}
