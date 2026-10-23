import { getClipAutomationMoveState } from '#/modules/Automation/useCases';
import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    captureProjectMutationAuthorization,
    getCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { getMidiStoreState, removeMidiClipData } from '#/modules/MIDI/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
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
import { isRemoveClipSessionEntry, isRemoveClipSessionPayload } from './validateClipEditSessionEntries';

// Minimal structural clip shape used to widen a concrete Clip into the structural
// `ClipSnapshot` carried by the `restoreClip` inverse action payload.
type MinimalClipShape = { id: string; trackId: string; name: string; startBeat: number; endBeat: number };

type RemoveClipAction = Extract<AppAction, { type: 'removeClip' }>;
type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;

// Batch descriptions precede every write. Keep the admitted inverse object,
// then fill it from the actual prefix when this member enters its transaction.
const pendingInverseCaptures = new WeakMap<object, RestoreClipAction>();
const pendingRedoCaptures = new WeakMap<object, RemoveClipAction>();

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
    validateSessionActionArguments: isRemoveClipSessionPayload,
    // Batch co-execution (grouped redo, atomic batches) preflights the state the
    // action assumes — the clip it names is still present — and refuses the whole
    // batch once a target is gone. Single-action dispatch never calls validate,
    // so the per-clip fallbacks in execute below are unchanged.
    validate: (action, context) =>
        (projectClipReplayPrefix(context.actions.slice(0, context.actionIndex))?.clips.some(
            (owner) => owner.clip.id === action.payload.clipId
        ) ??
            false) &&
        batchMembersAreIndependent(action, context),
    execute: (alpha) => {
        const trackId = findOwningTrackId(alpha.payload.clipId);
        if (!trackId) {
            pendingInverseCaptures.delete(alpha);
            pendingRedoCaptures.delete(alpha);
            return { status: 'no-write' };
        }
        const ripple = alpha.payload.ripple ?? workspaceStore.value?.rippleEditing ?? false;
        const pendingRedo = pendingRedoCaptures.get(alpha);
        pendingRedoCaptures.delete(alpha);
        const pendingInverse = pendingInverseCaptures.get(alpha);
        pendingInverseCaptures.delete(alpha);
        if (pendingInverse) {
            const fresh = handleRemoveClip.describe(alpha).inverseAction;
            if (fresh?.type === 'restoreClip') {
                pendingInverse.payload = fresh.payload;
            }
        }
        // Redo runs with skipUndo. Retain its actual producer capture so the
        // following Undo authenticates the shifted owners this replay wrote,
        // and restores exactly the material this replay retired.
        const paired = pairedInverseForRedo(alpha);
        const fresh = paired?.type === 'restoreClip' ? handleRemoveClip.describe(alpha).inverseAction : null;
        pendingRedoCaptures.delete(alpha);
        const documentBeforeReplay = fresh || pendingRedo ? captureDurableDocumentWitness() : null;
        const ownsPublication = fresh || pendingRedo ? captureProjectMutationAuthorization() : null;
        // Bind now, inside the actual handler scope, while its exact transaction
        // owner is visible. Later group members publish under this same owner.
        ownsPublication?.();
        const installCapture = () => {
            // Both successful and ambiguously published commits can run observers
            // before this effect. Only this mutation owner may refresh its inverse.
            if (getCrdtDoc('root') && captureDurableDocumentWitness() !== documentBeforeReplay && ownsPublication?.()) {
                if (fresh?.type === 'restoreClip') {
                    commitRedoInverseCapture(alpha, fresh);
                }
                if (pendingRedo) {
                    pendingRedo.payload.ripple = ripple;
                }
            }
        };
        const committedResult = () => {
            if (!fresh && !pendingRedo) {
                return undefined;
            }
            return {
                status: 'written' as const,
                afterCommit: installCapture,
                afterAmbiguousCommit: installCapture,
            };
        };

        const rippleResult = rippleDeleteClips({ trackId, clipIds: [alpha.payload.clipId], ripple });
        if (rippleResult === null) {
            removeClip(alpha.payload.clipId);
            return committedResult();
        }
        removeMidiClipData(rippleResult.removedClips.map((clip) => clip.id));
        return committedResult();
    },
    describe: (alpha, context) => {
        const state = getTrackStoreState();
        let clipSnapshot: MinimalClipShape | null = null;
        let trackId: string | null = null;
        let clipIndex: number | null = null;
        if (state) {
            for (const track of state.tracks) {
                const index = track.clips.findIndex((context) => context.id === alpha.payload.clipId);
                const clip = track.clips[index];
                if (clip) {
                    clipSnapshot = structuredClone(clip);
                    trackId = track.id;
                    clipIndex = index;
                    break;
                }
            }
        }
        if (!clipSnapshot || !trackId || clipIndex === null) {
            return { label: 'Remove clip' };
        }

        const plan = planRippleDelete({ trackId, clipIds: [alpha.payload.clipId], ripple: alpha.payload.ripple });
        const ripplePlan = plan
            ? {
                  removedClips: structuredClone(plan.removedClips) as readonly MinimalClipShape[],
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

        const inverseAction: RestoreClipAction = {
            type: 'restoreClip',
            payload: {
                clipId: alpha.payload.clipId,
                trackId,
                clipSnapshot,
                clipIndex,
                ripplePlan,
                midiNotesSnapshot: notes ? structuredClone(notes) : null,
                midiCcSnapshot: cc ? structuredClone(cc) : null,
                midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                retiredTakeLanes,
            },
        };
        if (context && context.actionIndex > 0) {
            pendingInverseCaptures.set(alpha, inverseAction);
        }
        // Resolve the preference again at the actual execution prefix, then
        // publish it into this history object only after its owner commits.
        const redoPayload: RemoveClipAction['payload'] = { clipId: alpha.payload.clipId };
        if (alpha.payload.ripple !== undefined) {
            redoPayload.ripple = alpha.payload.ripple;
        }
        const redoAction: RemoveClipAction = { type: 'removeClip', payload: redoPayload };
        pendingRedoCaptures.set(alpha, redoAction);
        return { label: `Remove clip "${clipSnapshot.name}"`, inverseAction, redoAction };
    },
    undoable: true,
});
