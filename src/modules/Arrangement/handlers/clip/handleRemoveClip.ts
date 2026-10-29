import { getChangesMetaSince, getHeads, hasHeads } from '@automerge/automerge';

import { getClipAutomationMoveState } from '#/modules/Automation/useCases';
import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    captureProjectIdentity,
    captureProjectMutationAuthorization,
    getCrdtDoc,
    readOwnedProjectPublications,
    hasForeignPendingProjectWrites,
} from '#/modules/CrdtDocument/useCases';
import { decodeMidiClipDataSnapshots, getMidiStoreState, removeMidiClipData } from '#/modules/MIDI/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { createHandler } from '#/utils/createHandler';
import {
    type ActionHandler,
    type AppAction,
    type HandlerValidationContext,
    type MidiClipDataActionSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { sanitizeTrackSnapshot } from '../../stores/trackStore';
import { readClipScopedAutomationLanes } from '../../useCases/clip/readClipScopedAutomationLanes';
import { removeClip } from '../../useCases/clip/removeClip';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { readClipMidiSnapshot } from '../../useCases/clipEditing/readClipMidiSnapshot';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { captureRetiredTakeSource } from '../../useCases/comping/captureRetiredTakeSource';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { planRippleDelete } from '../../useCases/rippleDelete/planRippleDelete';
import { rippleDeleteClips } from '../../useCases/rippleDelete/rippleDeleteClips';

import { createdClipMidiCapture } from './createdClipMidiCapture';
import { isRemoveClipSessionPayload } from './isRemoveClipSessionPayload';
import { pairedInverseForRedo } from './takeRetirementRedo';
import { isRemoveClipSessionEntry } from './validateClipEditSessionEntries';

// Minimal structural clip shape used to widen a concrete Clip into the structural
// `ClipSnapshot` carried by the `restoreClip` inverse action payload.
type MinimalClipShape = { id: string; trackId: string; name: string; startBeat: number; endBeat: number };

type RemoveClipAction = Extract<AppAction, { type: 'removeClip' }>;
type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;

// Batch descriptions precede every write. Keep the admitted inverse object,
// then fill it from the actual prefix when this member enters its transaction.
const pendingInverseCaptures = new WeakMap<object, RestoreClipAction>();
const pendingRedoCaptures = new WeakMap<object, RemoveClipAction>();
type RedoTarget = {
    owningTrackId: string;
    clip: unknown;
    midi: MidiClipDataActionSnapshot;
    creator?: AppAction;
};
type ProjectedMidiTarget = { snapshot: MidiClipDataActionSnapshot; creator?: AppAction };
const preflightRedoTargets = new WeakMap<object, RedoTarget>();

function capturedMidi(payload: RestoreClipAction['payload']): MidiClipDataActionSnapshot | null {
    const snapshots = decodeMidiClipDataSnapshots({
        notesSnapshot: payload.midiNotesSnapshot,
        controlChangeSnapshot: payload.midiCcSnapshot,
        pitchBendSnapshot: payload.midiPitchBendSnapshot,
    });
    if (!snapshots) {
        return null;
    }
    return {
        notes: { present: snapshots.notesSnapshot !== null, value: snapshots.notesSnapshot ?? [] },
        controlChanges: {
            present: snapshots.controlChangeSnapshot !== null,
            value: snapshots.controlChangeSnapshot ?? [],
        },
        pitchBends: { present: snapshots.pitchBendSnapshot !== null, value: snapshots.pitchBendSnapshot ?? [] },
    };
}

function midiIsAbsent(snapshot: MidiClipDataActionSnapshot): boolean {
    return !snapshot.notes.present && !snapshot.controlChanges.present && !snapshot.pitchBends.present;
}

function projectSplitMidiTarget(
    clipId: string,
    current: ProjectedMidiTarget,
    action: Extract<AppAction, { type: 'restoreClipSplitState' }>
): ProjectedMidiTarget | null {
    if (action.payload.clipId === clipId) {
        return { snapshot: action.payload.replacement.sourceMidi };
    }
    if (action.payload.rightClipId !== clipId) {
        return current;
    }
    const createsTarget = action.payload.replacement.rightClip && !action.payload.expected.rightClip;
    if (createsTarget && !midiIsAbsent(current.snapshot)) {
        return null;
    }
    return { snapshot: action.payload.replacement.rightMidi, creator: createsTarget ? action : undefined };
}

function projectedMidiTarget(clipId: string, priorActions: readonly AppAction[]): ProjectedMidiTarget | null {
    let current: ProjectedMidiTarget = { snapshot: readClipMidiSnapshot(clipId) };
    for (const action of priorActions) {
        if (
            (action.type === 'removeClip' || action.type === 'discardDuplicatedClip') &&
            action.payload.clipId === clipId
        ) {
            current = {
                snapshot: {
                    notes: { present: false, value: [] },
                    controlChanges: { present: false, value: [] },
                    pitchBends: { present: false, value: [] },
                },
            };
        } else if (action.type === 'duplicateClipAt' && action.payload.targetClipId === clipId) {
            if (!midiIsAbsent(current.snapshot)) {
                return null;
            }
            // The real producer mints the note identities during execution.
            // Only its completed pre-write receipt can authorize those rows.
            current = { ...current, creator: action };
        } else if (action.type === 'restoreClip' && action.payload.clipId === clipId) {
            const restored = capturedMidi(action.payload);
            if (!restored) {
                return null;
            }
            current = {
                snapshot: {
                    notes: restored.notes.present ? restored.notes : current.snapshot.notes,
                    controlChanges: restored.controlChanges.present
                        ? restored.controlChanges
                        : current.snapshot.controlChanges,
                    pitchBends: restored.pitchBends.present ? restored.pitchBends : current.snapshot.pitchBends,
                },
            };
        } else if (action.type === 'restoreClipSplitState') {
            const projected = projectSplitMidiTarget(clipId, current, action);
            if (!projected) {
                return null;
            }
            current = projected;
        }
    }
    return current;
}

function createdMidiMatchesCapture(
    actual: MidiClipDataActionSnapshot,
    expected: MidiClipDataActionSnapshot,
    creator: AppAction
): boolean {
    if (creator.type !== 'duplicateClipAt') {
        return valuesEqual(actual, expected);
    }
    // Duplicate remints only the note row ids randomly. Controller ids are
    // deterministic, and nested expression/ownership fields remain exact.
    return (
        actual.notes.present === expected.notes.present &&
        valuesEqual(
            actual.notes.value.map(({ id: _id, ...note }) => note),
            expected.notes.value.map(({ id: _id, ...note }) => note)
        ) &&
        valuesEqual(actual.controlChanges, expected.controlChanges) &&
        valuesEqual(actual.pitchBends, expected.pitchBends)
    );
}

/** The inverse producer owns document authority; Command only settles its staged history. */
function captureRemovalPublication(owner: object): () => (() => boolean) | null {
    const baseline = readOwnedProjectPublications(owner).length;
    const identity = captureProjectIdentity();
    return () => {
        const publications = readOwnedProjectPublications(owner).slice(baseline);
        if (publications.length === 0) {
            return null;
        }
        return () =>
            captureProjectIdentity() === identity &&
            publications.every(({ docId, heads }) => {
                const document = getCrdtDoc(docId);
                if (!document || !hasHeads(document, [...heads])) {
                    return false;
                }
                // A historical view shares backend futures and siblings. Only
                // heads in the installed frontier's causal closure attest this write.
                const outside = getChangesMetaSince(document, getHeads(document));
                return heads.every((head) => !outside.some((change) => change.hash === head));
            });
    };
}

function findOwningTrackId(clipId: string): string | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId))?.id;
}

function replayTargetMatches(clipId: string, expected: { owningTrackId: string; clip: unknown }): boolean {
    const owner = getTrackStoreState()?.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    const clip = owner?.clips.find((candidate) => candidate.id === clipId);
    return owner?.id === expected.owningTrackId && clip !== undefined && valuesEqual(clip, expected.clip);
}

function clipForSavedReplayComparison(
    target: { owningTrackId: string; clip: unknown },
    clipId: string,
    priorActions: readonly AppAction[]
): unknown {
    if (!priorActions.some((action) => action.type === 'duplicateClipAt' && action.payload.targetClipId === clipId)) {
        return target.clip;
    }
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === target.owningTrackId);
    if (!track) {
        return undefined;
    }
    // The producer's unset runtime optionals disappear from saved history. Keep
    // the raw target for execute, and compare its canonical saved view here only.
    return sanitizeTrackSnapshot({ tracks: [{ ...track, clips: [target.clip] }] }).tracks[0]?.clips[0];
}

/** A saved Redo may remove only the material its own inverse restored. */
function admittedRedoTarget(action: RemoveClipAction, context: HandlerValidationContext): boolean {
    const paired = pairedInverseForRedo(action);
    if (paired?.type !== 'restoreClip') {
        preflightRedoTargets.delete(action);
        return true;
    }
    if (hasForeignPendingProjectWrites()) {
        preflightRedoTargets.delete(action);
        return false;
    }
    // Earlier group members may have shifted this target before its own removal.
    // Compare the paired capture to that completed prefix, then pin it for execute.
    const priorActions = context.actions.slice(0, context.actionIndex);
    const projected = projectClipReplayPrefix(priorActions);
    const target = projected?.clips.find((owner) => owner.clip.id === action.payload.clipId);
    const expectedMidi = capturedMidi(paired.payload);
    const projectedMidi = projectedMidiTarget(action.payload.clipId, priorActions);
    if (
        !target ||
        !expectedMidi ||
        !projectedMidi ||
        (projectedMidi.creator?.type !== 'duplicateClipAt' && !valuesEqual(projectedMidi.snapshot, expectedMidi)) ||
        target.owningTrackId !== paired.payload.trackId ||
        !valuesEqual(
            clipForSavedReplayComparison(target, action.payload.clipId, priorActions),
            paired.payload.clipSnapshot
        )
    ) {
        preflightRedoTargets.delete(action);
        return false;
    }
    preflightRedoTargets.set(action, { ...target, midi: expectedMidi, creator: projectedMidi.creator });
    return true;
}

function redoTargetMatchesAtExecution(
    action: RemoveClipAction,
    context: HandlerValidationContext | undefined,
    paired: ReturnType<typeof pairedInverseForRedo>
): boolean {
    const preflightTarget = preflightRedoTargets.get(action);
    preflightRedoTargets.delete(action);
    if (paired?.type !== 'restoreClip') {
        return true;
    }
    if (!preflightTarget && context?.actions.length !== 1) {
        return false;
    }
    const expectedMidi = preflightTarget?.midi ?? capturedMidi(paired.payload);
    if (!expectedMidi) {
        return false;
    }
    const creator = preflightTarget?.creator;
    const midi = creator
        ? createdClipMidiCapture({ phase: 'take', action: creator, clipId: action.payload.clipId })
        : readClipMidiSnapshot(action.payload.clipId);
    return (
        midi !== null &&
        (creator ? createdMidiMatchesCapture(midi, expectedMidi, creator) : valuesEqual(midi, expectedMidi)) &&
        replayTargetMatches(
            action.payload.clipId,
            preflightTarget ?? {
                owningTrackId: paired.payload.trackId,
                clip: paired.payload.clipSnapshot,
            }
        )
    );
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

function prepareRemovalCapturePublication(
    alpha: RemoveClipAction,
    context: HandlerValidationContext | undefined,
    paired: ReturnType<typeof pairedInverseForRedo>,
    pendingRedo: RemoveClipAction | undefined,
    ripple: boolean
) {
    const pendingInverse = pendingInverseCaptures.get(alpha);
    pendingInverseCaptures.delete(alpha);
    const actualInverse = handleRemoveClip.describe(alpha).inverseAction;
    pendingInverseCaptures.delete(alpha);
    if (pendingInverse) {
        if (actualInverse?.type === 'restoreClip') {
            pendingInverse.payload = actualInverse.payload;
        }
    }
    // Redo runs with skipUndo. Retain its actual producer capture so the
    // following Undo authenticates the shifted owners this replay wrote,
    // and restores exactly the material this replay retired.
    const fresh = paired?.type === 'restoreClip' ? actualInverse : null;
    pendingRedoCaptures.delete(alpha);
    const sourceProof =
        actualInverse?.type === 'restoreClip' && actualInverse.payload.retiredTakeSourceProof
            ? captureRetiredTakeSource(
                  'removeClip',
                  actualInverse.payload.ripplePlan?.removedClips.map((clip) => clip.id) ?? [alpha.payload.clipId],
                  actualInverse.payload.retiredTakeLanes ?? [],
                  actualInverse.payload.retiredTakeSourceProof,
                  context?.undoEntryId
              )
            : undefined;
    const documentBeforeReplay = pendingRedo ? captureDurableDocumentWitness() : null;
    const ownsPublication = fresh || pendingRedo ? captureProjectMutationAuthorization() : null;
    // Bind now, inside the actual handler scope, while its exact transaction
    // owner is visible. Later group members publish under this same owner.
    ownsPublication?.();
    if (fresh && ownsPublication) {
        commitRedoInverseCapture({
            phase: 'stage',
            action: alpha,
            inverseAction: fresh,
            publicationAuthority: {
                captureIdentity: captureProjectIdentity,
                captureWitness: captureDurableDocumentWitness,
                captureOwnedPublication: captureRemovalPublication,
            },
        });
    }
    const installCapture = () => {
        // Publish the resolved preference only for its producer's own write.
        if (
            pendingRedo &&
            getCrdtDoc('root') &&
            captureDurableDocumentWitness() !== documentBeforeReplay &&
            ownsPublication?.()
        ) {
            pendingRedo.payload.ripple = ripple;
        }
    };
    const committedResult = () => {
        if (sourceProof && !sourceProof.captureWrittenState()) {
            sourceProof.validation.release();
            return { status: 'conflict' as const };
        }
        if (!fresh && !pendingRedo && !sourceProof) {
            return undefined;
        }
        return {
            status: 'written' as const,
            commitValidation: sourceProof?.validation,
            afterCommit: installCapture,
            afterAmbiguousCommit: installCapture,
        };
    };
    return { sourceProof, committedResult };
}

export const handleRemoveClip: ActionHandler<RemoveClipAction> = createHandler<'removeClip'>({
    validateSessionEntry: (entry) => {
        if (!isRemoveClipSessionEntry(entry)) {
            return false;
        }
        const inverse = entry.inverseAction;
        // Legacy saved removals omitted an empty take capture. Upgrade only
        // the validated history payload before it reaches strict live replay.
        if (inverse?.type === 'restoreClip' && !Object.hasOwn(inverse.payload, 'retiredTakeLanes')) {
            inverse.payload = { ...inverse.payload, retiredTakeLanes: [] };
        }
        return true;
    },
    validateSessionActionArguments: isRemoveClipSessionPayload,
    // Batch co-execution (grouped redo, atomic batches) preflights the state the
    // action assumes — the clip it names is still present — and refuses the whole
    // batch once a target is gone. Single-action dispatch never calls validate;
    // execute returns no-write before mutation when no track owns its target.
    validate: (action, context) =>
        (projectClipReplayPrefix(context.actions.slice(0, context.actionIndex))?.clips.some(
            (owner) => owner.clip.id === action.payload.clipId
        ) ??
            false) &&
        !hasForeignPendingProjectWrites() &&
        admittedRedoTarget(action, context) &&
        batchMembersAreIndependent(action, context),
    execute: (alpha, context) => {
        const trackId = findOwningTrackId(alpha.payload.clipId);
        if (!trackId) {
            pendingInverseCaptures.delete(alpha);
            pendingRedoCaptures.delete(alpha);
            return { status: 'no-write' };
        }
        const paired = pairedInverseForRedo(alpha);
        if (hasForeignPendingProjectWrites() || !redoTargetMatchesAtExecution(alpha, context, paired)) {
            preflightRedoTargets.delete(alpha);
            pendingInverseCaptures.delete(alpha);
            pendingRedoCaptures.delete(alpha);
            return { status: 'conflict' };
        }
        const ripple = alpha.payload.ripple ?? workspaceStore.value?.rippleEditing ?? false;
        const pendingRedo = pendingRedoCaptures.get(alpha);
        pendingRedoCaptures.delete(alpha);
        const { sourceProof, committedResult } = prepareRemovalCapturePublication(
            alpha,
            context,
            paired,
            pendingRedo,
            ripple
        );

        try {
            const rippleResult = rippleDeleteClips({ trackId, clipIds: [alpha.payload.clipId], ripple });
            if (rippleResult === null) {
                removeClip(alpha.payload.clipId);
                return committedResult();
            }
            removeMidiClipData(rippleResult.removedClips.map((clip) => clip.id));
            return committedResult();
        } catch (error) {
            sourceProof?.validation.release();
            throw error;
        }
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        let clipSnapshot: MinimalClipShape | null = null;
        let trackId: string | null = null;
        let clipIndex: number | null = null;
        let clipOrder: string[] = [];
        if (state) {
            for (const track of state.tracks) {
                const index = track.clips.findIndex((context) => context.id === alpha.payload.clipId);
                const clip = track.clips[index];
                if (clip) {
                    clipSnapshot = structuredClone(clip);
                    trackId = track.id;
                    clipIndex = index;
                    clipOrder = track.clips.map((candidate) => candidate.id);
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
                clipOrder,
                ripplePlan,
                midiNotesSnapshot: notes ? structuredClone(notes) : null,
                midiCcSnapshot: cc ? structuredClone(cc) : null,
                midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                retiredTakeLanes,
                retiredTakeSourceProof: { changeHash: '', memberId: '' },
            },
        };
        pendingInverseCaptures.set(alpha, inverseAction);
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
