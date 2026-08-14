import { type AppAction } from '#/utils/handlerContract';

import { compileCommandArgumentMetadata } from './commandArgumentMetadata';

export const COMMAND_TEMPO_TARGET_ID = '@project/transport/tempo';
export const COMMAND_TIME_SIGNATURE_TARGET_ID = '@project/transport/time-signature';
export const COMMAND_MASTER_GAIN_TARGET_ID = '@project/transport/master-gain';
export const COMMAND_MARKERS_TARGET_ID = '@project/arrangement/markers';
export const COMMAND_SECTIONS_TARGET_ID = '@project/arrangement/sections';
export const COMMAND_LOOP_TARGET_ID = '@project/transport/loop';
export const COMMAND_PUNCH_TARGET_ID = '@project/transport/punch';
export const COMMAND_METRONOME_TARGET_ID = '@project/transport/metronome';
export const COMMAND_COUNT_IN_TARGET_ID = '@project/transport/count-in';
export const COMMAND_PRE_ROLL_TARGET_ID = '@project/transport/pre-roll';
export const COMMAND_TIME_SIGNATURE_MAP_TARGET_ID = '@project/transport/time-signature-map';

function getProjectSlotTargetId(action: AppAction): string | null {
    switch (action.type) {
        case 'addMarker':
        case 'removeMarker':
        case 'setMarkerColor':
            return COMMAND_MARKERS_TARGET_ID;
        case 'addSection':
        case 'removeSection':
        case 'renameSection':
            return COMMAND_SECTIONS_TARGET_ID;
        case 'setLoopEnabled':
        case 'setLoopRegion':
        case 'restoreLoopRegion':
        case 'toggleLoop':
            return COMMAND_LOOP_TARGET_ID;
        case 'setPunchEnabled':
        case 'setPunchIn':
        case 'setPunchOut':
        case 'restorePunchRegion':
        case 'togglePunch':
            return COMMAND_PUNCH_TARGET_ID;
        case 'setMetronomeEnabled':
        case 'setMetronomeVolume':
        case 'toggleMetronome':
            return COMMAND_METRONOME_TARGET_ID;
        case 'setCountInBars':
        case 'toggleCountIn':
            return COMMAND_COUNT_IN_TARGET_ID;
        case 'setPreRollBars':
        case 'togglePreRoll':
            return COMMAND_PRE_ROLL_TARGET_ID;
        case 'addTimeSignatureChange':
        case 'removeTimeSignatureChange':
            return COMMAND_TIME_SIGNATURE_MAP_TARGET_ID;
        default:
            return null;
    }
}

export function getCommandDivergenceTargetIds(input: {
    actions: readonly AppAction[];
    targetIds: readonly string[];
}): string[] {
    const targetIds = new Set(input.targetIds);
    for (const action of input.actions) {
        const payload = action.payload;
        if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
            for (const reference of compileCommandArgumentMetadata(payload).objectReferences) {
                targetIds.add(reference.id);
            }
        }
        if (action.type === 'setTempo') {
            targetIds.add(COMMAND_TEMPO_TARGET_ID);
        } else if (action.type === 'setTimeSignature') {
            targetIds.add(COMMAND_TIME_SIGNATURE_TARGET_ID);
        } else if (action.type === 'setMasterGain' || action.type === 'restoreMasterGain') {
            targetIds.add(COMMAND_MASTER_GAIN_TARGET_ID);
        }
        const projectSlotTargetId = getProjectSlotTargetId(action);
        if (projectSlotTargetId) {
            targetIds.add(projectSlotTargetId);
        }
    }
    return [...targetIds];
}
