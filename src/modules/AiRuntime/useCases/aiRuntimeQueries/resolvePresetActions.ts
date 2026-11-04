import { type describeAction } from '#/modules/Command/useCases';

import { type PresetContext } from '../../models/PresetActions/Registry';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

import { resolveRawPresetActions } from './resolveRawPresetActions';

type ResolvePresetActionsInput = {
    presetId: string;
    context: PresetContext;
};

type ResolvePresetActionsOutput = Array<Parameters<typeof describeAction>[0]>;

export function resolvePresetActions(input: ResolvePresetActionsInput): ResolvePresetActionsOutput {
    const resolved = resolveRawPresetActions(input);
    if (resolved === null) {
        return [];
    }
    const materialized = materializeActionStateGuards(resolved.actions, getProjectContext());
    return materialized.status === 'accepted' ? materialized.actions : [];
}
