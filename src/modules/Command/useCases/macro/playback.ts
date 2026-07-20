import { type AppAction } from '#/utils/handlerContract';

import { macroStore } from '../../stores/macroStore';
import { executeAppAction } from '../executeAppAction';
import { generateGroupId } from '../generateGroupId';

type ReplayIdMappings = {
    layerIds: Map<string, string>;
    regionIds: Map<string, string>;
    vcaGroupIds: Map<string, string>;
};

function remapLayerId(layerId: string, mappings: ReplayIdMappings): string {
    return mappings.layerIds.get(layerId) ?? layerId;
}

function remapRegionId(regionId: string, mappings: ReplayIdMappings): string {
    return mappings.regionIds.get(regionId) ?? regionId;
}

function remapVcaGroupId(vcaGroupId: string, mappings: ReplayIdMappings): string {
    return mappings.vcaGroupIds.get(vcaGroupId) ?? vcaGroupId;
}

function remapVcaReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (action.type === 'assignToVca' || action.type === 'setVcaGain') {
        action.payload.vcaGroupId = remapVcaGroupId(action.payload.vcaGroupId, mappings);
    }
}

function remapAdjustmentReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (
        action.type === 'removeAdjustmentLayer' ||
        action.type === 'toggleAdjustmentLayer' ||
        action.type === 'setLayerParameter' ||
        action.type === 'setLayerMix' ||
        action.type === 'setLayerAffectedTracks' ||
        action.type === 'setLayerInsertionIndex'
    ) {
        action.payload.layerId = remapLayerId(action.payload.layerId, mappings);
        return;
    }
    if (action.type === 'removeAdjustmentRegion') {
        action.payload.layerId = remapLayerId(action.payload.layerId, mappings);
        action.payload.regionId = remapRegionId(action.payload.regionId, mappings);
        return;
    }
    if (action.type === 'moveAdjustmentRegion' || action.type === 'setLayerFades') {
        action.payload.regionId = remapRegionId(action.payload.regionId, mappings);
    }
}

function getGeneratedLayerId(action: AppAction): string | undefined {
    return action.type === 'createAdjustmentLayer' ? action.payload.layerId : undefined;
}

function getGeneratedRegionId(action: AppAction): string | undefined {
    return action.type === 'addAdjustmentRegion' ? action.payload.regionId : undefined;
}

function getGeneratedVcaGroupId(action: AppAction): string | undefined {
    if (action.type === 'createVcaGroup') {
        return action.payload.vcaGroupId;
    }
    return undefined;
}

async function executeMacroAction(
    action: AppAction,
    mappings: ReplayIdMappings,
    options: { groupId: string; groupLabel: string }
): Promise<void> {
    const replayAction = structuredClone(action);
    if (replayAction.type === 'createAdjustmentLayer') {
        const recordedLayerId = replayAction.payload.layerId;
        delete replayAction.payload.layerId;
        await executeAppAction(replayAction, options);
        const generatedLayerId = getGeneratedLayerId(replayAction);
        if (recordedLayerId && generatedLayerId) {
            mappings.layerIds.set(recordedLayerId, generatedLayerId);
        }
        return;
    }

    if (replayAction.type === 'addAdjustmentRegion') {
        replayAction.payload.layerId = remapLayerId(replayAction.payload.layerId, mappings);
        const recordedRegionId = replayAction.payload.regionId;
        delete replayAction.payload.regionId;
        await executeAppAction(replayAction, options);
        const generatedRegionId = getGeneratedRegionId(replayAction);
        if (recordedRegionId && generatedRegionId) {
            mappings.regionIds.set(recordedRegionId, generatedRegionId);
        }
        return;
    }

    if (replayAction.type === 'createVcaGroup') {
        const recordedVcaGroupId = replayAction.payload.vcaGroupId;
        delete replayAction.payload.vcaGroupId;
        await executeAppAction(replayAction, options);
        const generatedVcaGroupId = getGeneratedVcaGroupId(replayAction);
        if (recordedVcaGroupId && generatedVcaGroupId) {
            mappings.vcaGroupIds.set(recordedVcaGroupId, generatedVcaGroupId);
        }
        return;
    }

    remapAdjustmentReferences(replayAction, mappings);
    remapVcaReferences(replayAction, mappings);
    await executeAppAction(replayAction, options);
}

/**
 * Replay a saved macro by dispatching each action in sequence.
 * All actions share a single undo group so the entire macro can be
 * undone/redone as one atomic operation.
 */
export async function playMacro(macroId: string): Promise<void> {
    const state = macroStore.value;
    if (!state) {
        return;
    }

    const macro = state.macros.find((message) => message.id === macroId);
    if (!macro) {
        return;
    }

    const { groupId, groupLabel } = generateGroupId(`Macro: ${macro.name}`);
    const replayIdMappings: ReplayIdMappings = {
        layerIds: new Map(),
        regionIds: new Map(),
        vcaGroupIds: new Map(),
    };

    for (const action of macro.actions) {
        await executeMacroAction(action, replayIdMappings, { groupId, groupLabel });
    }
}
