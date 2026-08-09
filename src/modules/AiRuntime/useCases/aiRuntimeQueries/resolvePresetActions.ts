import { type describeAction } from '#/modules/Command/useCases';

import { PRESET_ACTIONS } from '../../models/PresetActions/Registry';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

type ResolvePresetActionsInput = {
    presetId: string;
    context: {
        selectedTrackId: string | undefined;
        selectedClipId: string | undefined;
        selectedClipType: 'audio' | 'midi' | undefined;
        trackCount: number;
    };
};

type ResolvePresetActionsOutput = Array<Parameters<typeof describeAction>[0]>;

export function resolvePresetActions({ presetId, context }: ResolvePresetActionsInput): ResolvePresetActionsOutput {
    const preset = PRESET_ACTIONS.find((candidate) => candidate.id === presetId);
    if (!preset) {
        return [];
    }

    const actionResult = preset.buildAction(context);
    if (actionResult === null) {
        return [];
    }

    const actions = Array.isArray(actionResult) ? actionResult : [actionResult];
    const materialized = materializeActionStateGuards(actions, getProjectContext());
    return materialized.status === 'accepted' ? materialized.actions : [];
}
