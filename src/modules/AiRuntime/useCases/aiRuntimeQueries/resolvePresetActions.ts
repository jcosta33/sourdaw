import { type describeAction } from '#/modules/Command/useCases';

import { PRESET_ACTIONS, type PresetContext } from '../../models/PresetActions/Registry';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

type ResolvePresetActionsInput = {
    presetId: string;
    context: PresetContext;
};

type ResolvePresetActionsOutput = Array<Parameters<typeof describeAction>[0]>;

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

export function resolvePresetActions(input: ResolvePresetActionsInput): ResolvePresetActionsOutput {
    const resolved = resolveRawPresetActions(input);
    if (resolved === null) {
        return [];
    }
    const materialized = materializeActionStateGuards(resolved.actions, getProjectContext());
    return materialized.status === 'accepted' ? materialized.actions : [];
}
