import { getClipAutomationMoveState } from '#/modules/Automation/useCases';
import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    captureProjectMutationAuthorization,
    getCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { getMidiStoreState, removeMidiClipData } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { readClipScopedAutomationLanes } from '../../useCases/clip/readClipScopedAutomationLanes';
import { removeClip } from '../../useCases/clip/removeClip';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { planRippleDelete } from '../../useCases/rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../useCases/rippleDelete/rippleDeleteClips';

import { pairedInverseForRedo } from './takeRetirementRedo';
import { isRemoveClipSessionEntry } from './validateClipEditSessionEntries';

// Minimal structural clip shape used to widen a concrete Clip into the structural
// `ClipSnapshot` carried by the `restoreClip` inverse action payload.
type MinimalClipShape = { id: string; trackId: string; name: string; startBeat: number; endBeat: number };

type RemoveClipAction = Extract<AppAction, { type: 'removeClip' }>;
type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;
type Description = { label: string; inverseAction?: RestoreClipAction | null };
const pendingDescriptions = new WeakMap<RemoveClipAction, Description>();

function findOwningTrackId(clipId: string): string | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId))?.id;
}

/**
 * Batch members of this handler must be mutually independent — no shared clip
 * target, no track removal inside a clip-member batch — because sequential
 * execution after a pre-state preflight cannot otherwise see a target another
 * member consumes: a second removeClip of the same clip would capture a second
 * restore inverse that re-appends a duplicate clip id, and a removeTrack of the
 * owning track would leave that inverse pointing at a track that no longer
 * exists, wedging the grouped undo that replays it.
 */
function batchMembersAreIndependent(action: RemoveClipAction, context: HandlerValidationContext): boolean {
    const otherMembers = context.actions.filter((_, index) => index !== context.actionIndex);
    if (otherMembers.length === 0) {
        return true;
    }
    const sharesClipTarget = otherMembers.some(
        (member) =>
            (member.type === 'removeClip' || member.type === 'restoreClip') &&
            member.payload.clipId === action.payload.clipId
    );
    if (sharesClipTarget) {
        return false;
    }
    const owningTrackId = findOwningTrackId(action.payload.clipId);
    return (
        !owningTrackId ||
        !otherMembers.some((member) => member.type === 'removeTrack' && member.payload.trackId === owningTrackId)
    );
}

export const handleRemoveClip = createHandler<'removeClip'>({
    validateSessionEntry: isRemoveClipSessionEntry,
    // Batch co-execution (grouped redo, atomic batches) preflights the state the
    // action assumes — the clip it names is still present — and refuses the whole
    // batch once a target is gone. Single-action dispatch never calls validate,
    // so the per-clip fallbacks in execute below are unchanged.
    validate: (action, context) => {
        const valid =
            (projectClipReplayPrefix(context.actions.slice(0, context.actionIndex))?.clips.some(
                (owner) => owner.clip.id === action.payload.clipId
            ) ??
                false) &&
            batchMembersAreIndependent(action, context);
        if (!valid) {
            discardPendingCapture(action);
        }
        return valid;
    },
    execute: (alpha) => {
        const pending = discardPendingCapture(alpha);
        // Redo runs with skipUndo. Retain its actual producer capture so the
        // following Undo authenticates the shifted owners this replay wrote,
        // and restores exactly the material this replay retired.
        const paired = pairedInverseForRedo(alpha);
        const actual = pending || paired?.type === 'restoreClip' ? describeRemoval(alpha) : null;
        const fresh = paired?.type === 'restoreClip' ? actual?.inverseAction : null;
        const documentBeforeReplay = fresh ? captureDurableDocumentWitness() : null;
        const ownsPublication = actual?.inverseAction ? captureProjectMutationAuthorization() : null;
        // Bind now, inside the actual handler scope, while its exact transaction
        // owner is visible. Later group members publish under this same owner.
        ownsPublication?.();
        const installCapture = () => {
            // Both successful and ambiguously published commits can run observers
            // before this effect. Only this mutation owner may refresh its inverse.
            if (
                fresh?.type === 'restoreClip' &&
                getCrdtDoc('root') &&
                captureDurableDocumentWitness() !== documentBeforeReplay &&
                ownsPublication?.()
            ) {
                commitRedoInverseCapture(alpha, fresh);
            }
        };
        const committedResult = () => {
            if (!fresh) {
                return undefined;
            }
            return {
                status: 'written' as const,
                afterCommit: installCapture,
                afterAmbiguousCommit: installCapture,
            };
        };

        executeRemoval(alpha);
        if (pending && actual?.inverseAction && ownsPublication?.() && !findOwningTrackId(alpha.payload.clipId)) {
            // Earlier batch members have applied. Record exactly the material
            // this removal received, after every owner write completed.
            Object.assign(pending, actual);
        }
        return committedResult();
    },
    describe: (alpha, context) => {
        discardPendingCapture(alpha);
        const description = describeRemoval(alpha);
        if (context?.executionMode !== 'isolated-preview') {
            pendingDescriptions.set(alpha, description);
        }
        return description;
    },
    undoable: true,
});

function describeRemoval(alpha: RemoveClipAction): Description {
    const state = getTrackStoreState();
    let clipSnapshot: MinimalClipShape | null = null;
    let trackId: string | null = null;
    if (state) {
        for (const track of state.tracks) {
            const clip = track.clips.find((context) => context.id === alpha.payload.clipId);
            if (clip) {
                clipSnapshot = structuredClone(clip);
                trackId = track.id;
                break;
            }
        }
    }
    if (!clipSnapshot || !trackId) {
        return { label: 'Remove clip' };
    }

    const plan = planRippleDelete({ trackId, clipIds: [alpha.payload.clipId] });
    const removedClips: readonly MinimalClipShape[] = structuredClone(plan?.removedClips ?? []);
    const ripplePlan = plan
        ? {
              removedClips,
              shiftedClips: plan.shiftedClips.map((shift) => ({
                  ...shift,
                  expectedAutomationLanes: getClipAutomationMoveState({
                      clipId: shift.clipId,
                      targetTrackId: trackId,
                      beatDelta: shift.automationDelta,
                  }).next,
              })),
              clipSatellites: plan.removedClips
                  .map((clip) => readClipSatelliteEntry(clip.id))
                  .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null),
              clipAutomationLanes: readClipScopedAutomationLanes(plan.removedClips.map((clip) => clip.id)),
          }
        : null;

    // Exactly the take-lane state the removal retires, captured before
    // `execute` writes: whichever route it takes — `rippleDeleteClips` or
    // the `removeClip` fallback — retires these clips' takes, and undo has
    // to put the lanes back as they were (#4265).
    const removedClipIds = plan ? plan.removedClips.map((clip) => clip.id) : [alpha.payload.clipId];
    const retiredTakeLanes = captureRetiredTakeLanes(removedClipIds);

    const midiState = getMidiStoreState();
    const notes = midiState?.notesByClipId[alpha.payload.clipId];
    const cc = midiState?.ccByClipId[alpha.payload.clipId];
    const pb = midiState?.pitchBendByClipId[alpha.payload.clipId];

    return {
        label: `Remove clip "${clipSnapshot.name}"`,
        inverseAction: {
            type: 'restoreClip',
            payload: {
                clipId: alpha.payload.clipId,
                trackId,
                clipSnapshot,
                ripplePlan,
                midiNotesSnapshot: notes ? structuredClone(notes) : null,
                midiCcSnapshot: cc ? structuredClone(cc) : null,
                midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                retiredTakeLanes,
            },
        },
    };
}

function executeRemoval(action: RemoveClipAction): void {
    const trackId = findOwningTrackId(action.payload.clipId);
    if (!trackId) {
        removeClip(action.payload.clipId);
        return;
    }
    const rippleResult = rippleDeleteClips({ trackId, clipIds: [action.payload.clipId] });
    if (rippleResult === null) {
        removeClip(action.payload.clipId);
        return;
    }
    removeMidiClipData(rippleResult.removedClips.map((clip) => clip.id));
}

function discardPendingCapture(action: RemoveClipAction): Description | undefined {
    const pending = pendingDescriptions.get(action);
    pendingDescriptions.delete(action);
    if (pending) {
        // Refusal, failure and no-write execution leave no reusable pre-prefix capture.
        pending.inverseAction = null;
    }
    return pending;
}
