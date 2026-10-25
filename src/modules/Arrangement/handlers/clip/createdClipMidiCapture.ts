import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type MidiClipDataActionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { readClipMidiSnapshot } from '../../useCases/clipEditing/readClipMidiSnapshot';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type CreatorAction = Extract<AppAction, { type: 'duplicateClipAt' | 'restoreClipSplitState' }>;
type CreatedCapture = {
    readonly clipId: string;
    readonly snapshot: MidiClipDataActionSnapshot;
    readonly isCurrent: () => boolean;
};
type PreparedCapture = {
    stage: (snapshot: MidiClipDataActionSnapshot) => void;
    complete: () => boolean;
    discard: () => void;
};
type PrepareInput = { phase: 'prepare'; action: CreatorAction; clipId: string };
type TakeInput = { phase: 'take'; action: AppAction; clipId: string };
type DiscardInput = { phase: 'discard'; action: AppAction };

// Nonpersistent execution authority, inaccessible from another mutation owner.
const capturesByOwner = new WeakMap<object, WeakMap<AppAction, CreatedCapture>>();
const discardByAction = new WeakMap<AppAction, () => void>();

function clipExists(clipId: string): boolean {
    return getTrackStoreState()?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId)) ?? false;
}

function snapshotIsAbsent(snapshot: MidiClipDataActionSnapshot): boolean {
    return !snapshot.notes.present && !snapshot.controlChanges.present && !snapshot.pitchBends.present;
}

function prepare(input: PrepareInput): PreparedCapture | null {
    discardByAction.get(input.action)?.();
    const namesTarget =
        input.action.type === 'duplicateClipAt'
            ? input.action.payload.targetClipId === input.clipId
            : input.action.payload.rightClipId === input.clipId &&
              input.action.payload.replacement.rightClip !== null &&
              input.action.payload.expected.rightClip === null;
    if (!namesTarget) {
        return null;
    }
    const owner = getCurrentAutomergeStorageMutationOwner();
    const root = getCrdtDoc('root');
    if (!owner || !root) {
        return null;
    }
    const absent = readClipMidiSnapshot(input.clipId);
    if (clipExists(input.clipId) || !snapshotIsAbsent(absent)) {
        return null;
    }
    const identity = captureProjectIdentity();
    const heads = new Set(getHeads(root));
    let closed = false;
    const isCurrent = () => {
        const current = getCrdtDoc('root');
        if (
            closed ||
            getCurrentAutomergeStorageMutationOwner() !== owner ||
            captureProjectIdentity() !== identity ||
            current === undefined
        ) {
            return false;
        }
        // The enclosing transaction publishes only after this receipt is consumed.
        // Available historical heads do not prove the installed frontier.
        const currentHeads = getHeads(current);
        return currentHeads.length === heads.size && currentHeads.every((head) => heads.has(head));
    };
    let snapshot = absent;
    let completed = false;
    const discard = () => {
        closed = true;
        capturesByOwner.get(owner)?.delete(input.action);
        discardByAction.delete(input.action);
    };
    return {
        stage: (constructed) => {
            if (!completed && !closed) {
                snapshot = structuredClone(constructed);
            }
        },
        complete: () => {
            if (completed || closed) {
                return false;
            }
            completed = true;
            if (
                !isCurrent() ||
                !clipExists(input.clipId) ||
                !valuesEqual(readClipMidiSnapshot(input.clipId), snapshot)
            ) {
                discard();
                return false;
            }
            let captures = capturesByOwner.get(owner);
            if (!captures) {
                captures = new WeakMap();
                capturesByOwner.set(owner, captures);
            }
            captures.set(input.action, { clipId: input.clipId, snapshot, isCurrent });
            discardByAction.set(input.action, discard);
            return true;
        },
        discard,
    };
}

/** Only a successful creator can publish its pre-write constructed MIDI values. */
export function createdClipMidiCapture(input: PrepareInput): PreparedCapture | null;
export function createdClipMidiCapture(input: TakeInput): MidiClipDataActionSnapshot | null;
export function createdClipMidiCapture(input: DiscardInput): void;
export function createdClipMidiCapture(
    input: PrepareInput | TakeInput | DiscardInput
): PreparedCapture | MidiClipDataActionSnapshot | null | void {
    if (input.phase === 'prepare') {
        return prepare(input);
    }
    if (input.phase === 'discard') {
        discardByAction.get(input.action)?.();
        return;
    }
    const owner = getCurrentAutomergeStorageMutationOwner();
    const capture = owner ? capturesByOwner.get(owner)?.get(input.action) : undefined;
    const matches =
        capture !== undefined &&
        capture.clipId === input.clipId &&
        capture.isCurrent() &&
        valuesEqual(readClipMidiSnapshot(input.clipId), capture.snapshot);
    discardByAction.get(input.action)?.();
    return matches && capture ? structuredClone(capture.snapshot) : null;
}
