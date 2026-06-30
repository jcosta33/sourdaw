import { PRESET_ACTIONS } from '../../models/PresetActions/Registry';

import type { PresetSearchContext } from './helpers';

export type ResolvePresetActionsInput = {
    presetId: string;
    context: PresetSearchContext;
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
