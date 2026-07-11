type ToPromptPresetInput = {
    id: string;
    label: string;
    category:
        | 'Transport'
        | 'Track'
        | 'Clip'
        | 'MIDI'
        | 'Device'
        | 'Workspace'
        | 'Mix'
        | 'Generate'
        | 'File'
        | 'Automation'
        | 'Collaboration';
    isDestructive?: boolean;
};

type ToPromptPresetOutput = {
    id: string;
    label: string;
    category: ToPromptPresetInput['category'];
    isDestructive: boolean;
};

export function toPromptPreset(preset: ToPromptPresetInput): ToPromptPresetOutput {
    return {
        id: preset.id,
        label: preset.label,
        category: preset.category,
        isDestructive: preset.isDestructive ?? false,
    };
}
