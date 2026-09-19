import { getStableContractFingerprint } from '../models/GetStableContractFingerprint';
import { type SoundPreset } from '../models/SoundPreset';

import { getUserPresets } from './preset/presetStorage/getUserPresets';
import { getFactoryPresets } from './soundPresetLibrary';

type AgentPresetDiscoveryEntry = {
    id: string;
    name: string;
    category: SoundPreset['category'];
    subcategory: string | null;
    description: string;
    trackKind: SoundPreset['trackKind'];
    isFactory: boolean;
    tags: readonly string[];
    deviceTypes: readonly string[];
    version: string;
    metadata: { source: 'Arrangement SoundPreset'; confidence: 'declared' | 'user-supplied' };
};

function toDiscoveryEntry(preset: SoundPreset): AgentPresetDiscoveryEntry {
    return {
        id: preset.id,
        name: preset.name,
        category: preset.category,
        subcategory: preset.subcategory ?? null,
        description: preset.description,
        trackKind: preset.trackKind,
        isFactory: preset.isFactory,
        tags: preset.tags,
        deviceTypes: preset.devices.map((device) => device.type),
        version: `preset-v1:${getStableContractFingerprint(preset)}`,
        metadata: {
            source: 'Arrangement SoundPreset',
            confidence: preset.isFactory ? 'declared' : 'user-supplied',
        },
    };
}

/** Arrangement publishes bounded preset discovery evidence without exposing device parameter values. */
export function getAgentPresetDiscoveryManifest(): readonly AgentPresetDiscoveryEntry[] {
    return [...getFactoryPresets(), ...getUserPresets()].map(toDiscoveryEntry);
}
