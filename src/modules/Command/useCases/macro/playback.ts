import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { macroGeneratedIdByActionType, noGeneratedId } from '../../models/MacroGeneratedId';
import {
    type MacroReplayCreate,
    macroReplayCreateByActionType,
    notAGeneratedCreate,
    type MacroReplayReads,
} from '../../models/MacroReplayCreate';
import { type MacroReplayIdMappings } from '../../models/MacroReplayIdMappings';
import { keepRecordedPayload, macroReplayPayloadResetByActionType } from '../../models/MacroReplayPayloadReset';
import { leaveReferencesUnmapped, macroReplayRemapByActionType } from '../../models/MacroReplayRemap';
import { getHandlerByType } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { executeAppAction } from '../executeAppAction';
import { generateGroupId } from '../generateGroupId';
import { materializeCommandApplicationIds } from '../materializeCommandApplicationIds';
import { materializeCommandHandlerArguments } from '../materializeCommandHandlerArguments';

import { lowerSourceMacroAction } from './lowerSourceMacroAction';
import { macroCoreReads } from './macroCoreReads';
import { replayTempoMapMacroAction } from './tempoMapMacroReplay';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

/**
 * The lane id a replayed addAutomationLane actually produced. When the track
 * already owns a track-level lane for the parameter, the handler's noop gate
 * drops the dispatch and no lane carries the pre-minted id, so the recorded id
 * must map onto the lane the fold folded into — the same track-level resolution
 * `isAddAutomationLaneNoop` folds on. A materialized minted id, or no matching
 * lane at all, leaves the minted id standing.
 */
function resolveMaterializedLaneId(generatedLaneId: string, target: { trackId: string; parameterId: string }): string {
    const lanes = macroCoreReads.read('resolveMaterializedLaneId').readAutomationLanes();
    if (lanes?.some((lane) => lane.id === generatedLaneId)) {
        return generatedLaneId;
    }
    return (
        lanes?.find(
            (lane) => !lane.clipId && lane.trackId === target.trackId && lane.parameterId === target.parameterId
        )?.id ?? generatedLaneId
    );
}

type GeneratedIds = string | readonly string[] | undefined;

/** The replayed create with the kernel's ids and then its handler's own drawn ids in place. */
function materializeReplayedCreate(replayAction: AppAction): AppAction {
    const kernelMaterialized = materializeCommandApplicationIds(replayAction).action;
    const handler = getHandlerByType(kernelMaterialized.type);
    if (!handler) {
        return kernelMaterialized;
    }
    return materializeCommandHandlerArguments(kernelMaterialized, handler);
}

/**
 * Dispatch a replayed create and return the generated ids the executed command
 * carried. executeAppAction materializes its own copy of the action and never
 * writes generated ids back onto the caller's object (#4817), so the ids are
 * minted here through the same kernel and handler materializations
 * executeAppAction will repeat idempotently, and read back from the action that
 * was actually dispatched.
 */
async function executeGeneratedCreate(
    replayAction: AppAction,
    options: { groupId: string; groupLabel: string }
): Promise<GeneratedIds> {
    const materialized = materializeReplayedCreate(replayAction);
    await executeAppAction(materialized, options);
    return lookupGeneratedId(materialized);
}

function toIdList(ids: GeneratedIds): readonly string[] {
    if (ids === undefined) {
        return [];
    }
    return typeof ids === 'string' ? [ids] : ids;
}

function lookupRemap<Type extends AppActionType>(action: ActionOf<Type>, mappings: MacroReplayIdMappings): void {
    if (!Object.hasOwn(macroReplayRemapByActionType, action.type)) {
        leaveReferencesUnmapped();
        return;
    }
    macroReplayRemapByActionType[action.type](action, mappings);
}

function lookupGeneratedId<Type extends AppActionType>(action: ActionOf<Type>): GeneratedIds {
    if (!Object.hasOwn(macroGeneratedIdByActionType, action.type)) {
        return noGeneratedId();
    }
    return macroGeneratedIdByActionType[action.type](action);
}

function lookupCreate<Type extends AppActionType>(
    action: ActionOf<Type>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate | null {
    if (!Object.hasOwn(macroReplayCreateByActionType, action.type)) {
        return notAGeneratedCreate();
    }
    return macroReplayCreateByActionType[action.type](action, mappings);
}

function lookupPayloadReset<Type extends AppActionType>(action: ActionOf<Type>): AppAction {
    if (!Object.hasOwn(macroReplayPayloadResetByActionType, action.type)) {
        return keepRecordedPayload(action);
    }
    return macroReplayPayloadResetByActionType[action.type](action);
}

const macroReplayReads: MacroReplayReads = { resolveMaterializedLaneId };

async function executeMacroAction(
    action: AppAction,
    mappings: MacroReplayIdMappings,
    options: { groupId: string; groupLabel: string }
): Promise<void> {
    if (action.type === 'editTempoMap' || action.type === 'restoreTempoMapEdit') {
        await replayTempoMapMacroAction(action, mappings.tempoRowIds, options);
        return;
    }
    const replayAction = lookupPayloadReset(lowerSourceMacroAction(action, mappings.tempoRowIds));
    const create = lookupCreate(replayAction, mappings);
    if (create) {
        const generatedIds = toIdList(await executeGeneratedCreate(replayAction, options));
        // A list create pairs its ids by position, up to the shorter list.
        for (const [index, recordedId] of toIdList(create.recordedId).entries()) {
            const generatedId = generatedIds[index];
            if (recordedId && generatedId) {
                create.remember(recordedId, generatedId, macroReplayReads);
            }
        }
        return;
    }
    lookupRemap(replayAction, mappings);
    await executeAppAction(replayAction, options);
}

/**
 * Replay a saved macro by dispatching each action in sequence.
 * Batch-capable actions share an Undo group; singleton handlers retain
 * their individual Undo steps.
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
    if (macro.actions.some((action) => action.type === 'insertAutomationLanePoints')) {
        throw new AppActionConflictError('playMacro', 'Automation lane insertions are local edits.');
    }

    if (macro.actions.some((action) => action.type === 'setLevainIdentity')) {
        throw new AppActionConflictError('playMacro', 'Levain identity changes are local edits.');
    }

    // Singleton-marked actions (domain-singleton handlers such as drawClip and
    // moveClips) replay through this same per-action loop — the individual
    // dispatch path they are defined for — instead of being refused. The kernel
    // drops the group id for them, so each lands as its own undo entry; every
    // batch-capable action still shares the macro's group below.
    const { groupId, groupLabel } = generateGroupId(`Macro: ${macro.name}`);
    const replayIdMappings: MacroReplayIdMappings = {
        tempoRowIds: new Map(),
        automationLaneIds: new Map(),
        automationPointIds: new Map(),
        sidechainRouteIds: new Map(),
        chordEventIds: new Map(),
        layerIds: new Map(),
        regionIds: new Map(),
        vcaGroupIds: new Map(),
        markerIds: new Map(),
        sectionIds: new Map(),
        trackAlternativeIds: new Map(),
        scratchPadSectionIds: new Map(),
    };

    for (const action of macro.actions) {
        // The preceding step records history after its product transaction.
        // Settle that pending truth before the next owner captures its source.
        flushAutomergeStorageWrites();
        await executeMacroAction(action, replayIdMappings, { groupId, groupLabel });
    }
}
