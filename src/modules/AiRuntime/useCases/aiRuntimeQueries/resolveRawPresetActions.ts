import { PRESET_ACTIONS, type PresetContext } from '../../models/PresetActions/Registry';

type ResolvePresetActionsInput = {
    presetId: string;
    context: PresetContext;
};

export function resolveRawPresetActions({ presetId, context }: ResolvePresetActionsInput) {
    const preset = PRESET_ACTIONS.find((candidate) => candidate.id === presetId);
    if (!preset) {
        return null;
    }

    const actionResult = preset.buildAction(context);
    if (actionResult === null) {
        return null;
    }

    const actions = Array.isArray(actionResult) ? actionResult : [actionResult];
    return { preset, actions };
}
