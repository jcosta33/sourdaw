/**
 * Workspace-local view shape of Arrangement's SoundPreset (AGENTS.md §95).
 * This is NOT a re-export — it is Workspace's own duplicated type containing
 * the fields Workspace views render. Changes to Arrangement's model will break
 * this at the consumption sites (structural compatibility), which is the
 * intended signal.
 */

export type SoundPresetCategory =
    'synth' | 'bass' | 'pad' | 'lead' | 'keys' | 'drums' | 'fx' | 'vocal' | 'guitar' | 'strings';

export type DevicePresetView = {
    type: string;
    name: string;
    parameterValues: Record<string, number>;
};

export type SoundPresetView = {
    id: string;
    name: string;
    category: SoundPresetCategory;
    subcategory?: string;
    description: string;
    trackKind: 'midi' | 'audio' | 'folder';
    devices: DevicePresetView[];
    tags: string[];
    author: string;
    isFactory: boolean;
};
