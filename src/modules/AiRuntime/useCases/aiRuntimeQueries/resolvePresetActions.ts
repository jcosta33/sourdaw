import { type describeAction } from '#/modules/Command/useCases';

import { PRESET_ACTIONS } from '../../models/PresetActions/Registry';

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

    return Array.isArray(actionResult) ? actionResult : [actionResult];
}
