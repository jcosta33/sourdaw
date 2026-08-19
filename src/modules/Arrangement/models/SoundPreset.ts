export type DevicePreset = {
    type: string;
    name: string;
    parameterValues: Record<string, number>;
};

export type SoundPresetCategory =
    'synth' | 'bass' | 'pad' | 'lead' | 'keys' | 'drums' | 'fx' | 'vocal' | 'guitar' | 'strings';

export type SoundPreset = {
    id: string;
    name: string;
    category: SoundPresetCategory;
    subcategory?: string;
    description: string;
    trackKind: 'midi' | 'audio' | 'folder';
    devices: DevicePreset[];
    tags: string[];
    author: string;
    isFactory: boolean;
};
