import { logger } from '#/infra/logger/appLogger';
import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { type ProofPatchSelection, type ProofPatchSelectionAction } from '../events/proofAppActions';
import { DEFAULT_PATCH, TARGET_LUFS } from '../models/ProofPatch';
import { isValidProofPatch } from '../services/isValidProofPatch';
import { getProofState } from '../stores/proofStore';

import { readRestoredProofTarget } from './proofParamBridge/rehydrateRestoredPatch';
import { syncProofPatchSelection } from './proofParamBridge/syncProofPatchSelection';
import { proofPatchSelectionParameterIds, proofPatchSelectionParameters } from './proofPatchSelection';
import { getProofFactoryPreset } from './proofPresets';
import { readProofPatchSelectionOwner } from './readProofPatchSelectionOwner';

type Payload = ProofPatchSelectionAction['payload'];
type CommittedParameters = Payload['after']['parameters'];

const pendingSelections = new Map<string, Promise<CommittedParameters>>();

function planSelection(deviceId: string, selection: ProofPatchSelection) {
    const parameters = proofPatchSelectionParameters(selection);
    if (!parameters) {
        return null;
    }
    const parameterIds = proofPatchSelectionParameterIds(selection);
    const owner = readProofPatchSelectionOwner(deviceId, parameterIds);
    if (!owner) {
        return null;
    }
    const authority = captureDevicePatchCommitValidation({
        trackId: owner.trackId,
        deviceId,
        parameterIds,
        requireCurrentProjection: true,
    });
    return authority ? { deviceId, selection, parameters, parameterIds, owner, authority } : null;
}

type SelectionPlan = NonNullable<ReturnType<typeof planSelection>>;

function matchesQueuedSource(
    plan: SelectionPlan,
    priorWrites: CommittedParameters,
    current: SelectionPlan['owner']
): boolean {
    // Only an earlier click's committed writes may advance the source captured
    // at enqueue. A peer write or a replaced owner must refuse the queued edit.
    const expected = { ...plan.owner.state.parameterValues };
    for (const [key, value] of Object.entries(priorWrites)) {
        if (Object.hasOwn(expected, key)) {
            expected[key] = value;
        }
    }
    return (
        valuesEqual(current.state.deviceState, plan.owner.state.deviceState) &&
        valuesEqual(current.state.parameterValues, expected) &&
        plan.authority.matchesCommittedParameters(expected)
    );
}

function selectionPayload(
    { deviceId, selection, parameters }: SelectionPlan,
    owner: SelectionPlan['owner']
): Payload | null {
    const { patch } = getProofState(deviceId);
    const { name, presetId } = patch;
    const before = { parameters: owner.state.parameterValues, name, presetId: presetId ?? null };
    if (selection.kind === 'target') {
        const { target } = selection;
        const targetLufs = TARGET_LUFS[target];
        if (valuesEqual(before.parameters, parameters) || !isValidProofPatch({ ...patch, target, targetLufs })) {
            return null;
        }
        const previous = readRestoredProofTarget(before.parameters) ?? DEFAULT_PATCH;
        const targetUnchanged = previous.target === target && previous.targetLufs === targetLufs;
        const after = { parameters, name, presetId: targetUnchanged ? before.presetId : null };
        return { deviceId, trackId: owner.trackId, deviceIds: owner.deviceIds, selection, before, after };
    }
    const preset = getProofFactoryPreset(selection.presetId);
    if (!preset) {
        return null;
    }
    const after = { parameters, name: preset.name, presetId: preset.id };
    return { deviceId, trackId: owner.trackId, deviceIds: owner.deviceIds, selection, before, after };
}

async function commitSelection(plan: SelectionPlan, priorWrites: CommittedParameters): Promise<CommittedParameters> {
    const { deviceId, selection, parameterIds } = plan;
    const owner = readProofPatchSelectionOwner(deviceId, parameterIds);
    if (!owner || !matchesQueuedSource(plan, priorWrites, owner)) {
        return priorWrites;
    }
    const authority = captureDevicePatchCommitValidation({
        trackId: owner.trackId,
        deviceId,
        parameterIds,
        requireCurrentProjection: true,
    });
    const payload = selectionPayload(plan, owner);
    if (!authority || !payload) {
        return priorWrites;
    }

    const alreadyApplied = valuesEqual(payload.before.parameters, payload.after.parameters);
    const receipt: { observed: boolean; committed: boolean } = { observed: false, committed: false };
    try {
        await executeUserAppAction(
            { type: 'setProofPatchSelection', payload },
            {
                shouldExecute: authority.isCurrent,
                shouldCommit: authority.isCurrent,
                skipMacroRecording: true,
                observeMaterializedAction: () => {
                    receipt.observed = true;
                },
                onCommitted: () => {
                    receipt.committed = true;
                },
            }
        );
        if (selection.kind === 'preset' && alreadyApplied && receipt.observed && authority.isCurrent()) {
            // An equal preset selection still sets its identity and reasserts its sound.
            syncProofPatchSelection(deviceId, selection, payload.after);
        }
    } catch (error) {
        logger.error(new Error('Proof selection failed', { cause: error }));
        if (isAppActionCommittedError(error)) {
            notifyUser('The Proof change was saved, but could not finish applying.', 'warning');
        } else {
            notifyUser('Could not apply the Proof change.', 'error');
        }
    }
    return receipt.committed ? { ...priorWrites, ...payload.after.parameters } : priorWrites;
}

export async function selectProofPatch(deviceId: string, selection: ProofPatchSelection): Promise<void> {
    const plan = planSelection(deviceId, selection);
    if (!plan) {
        return;
    }
    const previous = pendingSelections.get(deviceId);
    const pending = previous
        ? previous.then((priorWrites) => commitSelection(plan, priorWrites))
        : commitSelection(plan, {});
    pendingSelections.set(deviceId, pending);
    try {
        await pending;
    } finally {
        if (pendingSelections.get(deviceId) === pending) {
            pendingSelections.delete(deviceId);
        }
    }
}

/** Keep a click bound to its original owner while a ceiling gesture settles. */
export function prepareProofPatchSelection(deviceId: string, selection: ProofPatchSelection): () => void {
    const parameterIds: readonly string[] = [];
    const owner = readProofPatchSelectionOwner(deviceId, parameterIds);
    const authority = owner
        ? captureDevicePatchCommitValidation({
              trackId: owner.trackId,
              deviceId,
              parameterIds,
              requireCurrentProjection: true,
          })
        : null;
    return () => {
        if (authority?.isCurrent()) {
            void selectProofPatch(deviceId, selection);
        }
    };
}
