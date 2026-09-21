import { DEVICE_CHARACTER_TAGS } from '../models/DeviceParameterTypes';
import { getStableContractFingerprint } from '../models/GetStableContractFingerprint';
import { type SoundPreset } from '../models/SoundPreset';

import { getUserPresets } from './preset/presetStorage/getUserPresets';
import { getFactoryPresets } from './soundPresetLibrary';

const MAX_DISCOVERY_NAME_LENGTH = 128;
const MAX_DISCOVERY_SUBCATEGORY_LENGTH = 128;
const MAX_DISCOVERY_DESCRIPTION_LENGTH = 1_024;
const MAX_DISCOVERY_LIST_ITEMS = 8;
const MAX_DISCOVERY_LIST_TEXT_LENGTH = 128;

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
    /** Full owner terms stay private to the candidate matcher rather than inflating receipt evidence. */
    searchTerms: readonly string[];
    version: string;
    metadata: { source: 'Arrangement SoundPreset'; confidence: 'declared' | 'user-supplied' };
};

function boundedDiscoveryText(value: string, maximumLength: number): string {
    return Array.from(value.toWellFormed().normalize('NFC'))
        .filter((character) => {
            const codePoint = character.codePointAt(0)!;
            return codePoint > 0x1f && codePoint !== 0x7f;
        })
        .slice(0, maximumLength)
        .join('');
}

function boundedDiscoveryTextList(values: readonly string[]): string[] {
    return values
        .slice(0, MAX_DISCOVERY_LIST_ITEMS)
        .map((value) => boundedDiscoveryText(value, MAX_DISCOVERY_LIST_TEXT_LENGTH));
}

function boundedDiscoveryTags(tags: readonly string[]): string[] {
    const boundedTags = boundedDiscoveryTextList(tags);
    const omittedCharacterTags = DEVICE_CHARACTER_TAGS.filter(
        (tag) => tags.includes(tag) && !boundedTags.includes(tag)
    );
    return [...boundedTags, ...omittedCharacterTags];
}

function boundedDiscoverySubcategory(value: string | undefined): string | null {
    if (value === undefined) {
        return null;
    }
    return boundedDiscoveryText(value, MAX_DISCOVERY_SUBCATEGORY_LENGTH);
}

function toDiscoveryEntry(preset: SoundPreset, isFactory: boolean): AgentPresetDiscoveryEntry {
    return {
        id: preset.id,
        name: boundedDiscoveryText(preset.name, MAX_DISCOVERY_NAME_LENGTH),
        category: preset.category,
        subcategory: boundedDiscoverySubcategory(preset.subcategory),
        description: boundedDiscoveryText(preset.description, MAX_DISCOVERY_DESCRIPTION_LENGTH),
        trackKind: preset.trackKind,
        isFactory,
        tags: boundedDiscoveryTags(preset.tags),
        deviceTypes: boundedDiscoveryTextList(preset.devices.map((device) => device.type)),
        searchTerms: [preset.name, ...preset.tags],
        version: `preset-v1:${getStableContractFingerprint(preset)}`,
        metadata: {
            source: 'Arrangement SoundPreset',
            confidence: isFactory ? 'declared' : 'user-supplied',
        },
    };
}

/** Arrangement publishes bounded preset discovery evidence without exposing device parameter values. */
export function getAgentPresetDiscoveryManifest(): readonly AgentPresetDiscoveryEntry[] {
    return [
        ...getFactoryPresets().map((preset) => toDiscoveryEntry(preset, preset.isFactory)),
        ...getUserPresets().map((preset) => toDiscoveryEntry(preset, false)),
    ];
}
