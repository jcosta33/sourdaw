import { PRESET_ACTIONS, type PresetContext } from '../../models/PresetActions/Registry';

export type ResolvePresetActionsInput = {
    presetId: string;
    context: PresetContext;
};

export function resolvePresetActions({ presetId, context }: ResolvePresetActionsInput) {
    const preset = PRESET_ACTIONS.find((candidate) => candidate.id === presetId);
    if (!preset) {
        return [];
    }

    const actionResult = preset.buildAction(context);
    if (actionResult === null) {
        return [];
    }

    return Array.isArray(actionResult) ? actionResult : [actionResult];
}
