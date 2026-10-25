import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type HandlerCommitValidation } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { trackStore } from '../../stores/trackStore';

type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;
type LocatedClip = { trackId: string; clipIndex: number; clip: Readonly<Record<string, unknown>> };
type Owners = Map<string, LocatedClip[]>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOwners(slot: unknown, ids: ReadonlySet<string>): Owners | null {
    if (!isRecord(slot) || !Array.isArray(slot.tracks)) {
        return null;
    }
    const owners: Owners = new Map([...ids].map((id) => [id, []]));
    for (const track of slot.tracks) {
        if (!isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.clips)) {
            return null;
        }
        for (const [clipIndex, clip] of track.clips.entries()) {
            if (!isRecord(clip) || typeof clip.id !== 'string') {
                return null;
            }
            const located = owners.get(clip.id);
            if (located) {
                const captured: unknown = JSON.parse(JSON.stringify(clip));
                if (!isRecord(captured)) {
                    return null;
                }
                located.push({ trackId: track.id, clipIndex, clip: captured });
            }
        }
    }
    return owners;
}

function ownersMatch(left: Owners | null, right: Owners | null): boolean {
    return left !== null && right !== null && [...left].every(([id, owners]) => valuesEqual(owners, right.get(id)));
}

/** Retain affected-owner intent independently from a peer-rebased optimistic projection. */
export function captureRestoreClipCommitValidation(
    action: RestoreClipAction
): { validation: HandlerCommitValidation; captureWrittenState: () => boolean } | undefined {
    const owner = getCurrentAutomergeStorageMutationOwner();
    const root = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
    if (!owner || !root) {
        return undefined;
    }
    const ids = new Set([
        ...(action.payload.ripplePlan?.removedClips.map((clip) => clip.id) ?? [action.payload.clipId]),
        ...(action.payload.ripplePlan?.shiftedClips.map((clip) => clip.clipId) ?? []),
    ]);
    const before = readOwners(root.tracks, ids);
    let observed = readOwners(trackStore.value, ids);
    let expected: Owners | null = null;
    let observedHeads = getHeads(root).toSorted();
    let authorityIntervened = false;
    let release = trackStore.subscribe((state) => {
        const next = readOwners(state, ids);
        const currentRoot = getCrdtDoc('root');
        const nextHeads = currentRoot ? getHeads(currentRoot).toSorted() : [];
        authorityIntervened ||= !valuesEqual(observedHeads, nextHeads);
        // A publication may hydrate under an entered owner scope, even after
        // another notification observed its heads. Keep the admitted intent
        // once authority intervenes; the final owner check still permits it
        // when the intended effect survives that publication.
        if (
            expected &&
            observed &&
            next &&
            !authorityIntervened &&
            getCurrentAutomergeStorageMutationOwner() === owner
        ) {
            for (const id of ids) {
                if (!valuesEqual(observed.get(id), next.get(id))) {
                    expected.set(id, next.get(id) ?? []);
                }
            }
        }
        observed = next;
        observedHeads = nextHeads;
    });
    const validation: HandlerCommitValidation = {
        beforeCommit: () =>
            ownersMatch(before, readOwners(getCrdtDoc<Readonly<Record<string, unknown>>>('root')?.tracks, ids))
                ? null
                : 'Clip restore owners changed before commit',
        documentId: 'root',
        validateDocument: (document) =>
            ownersMatch(expected, readOwners(document.tracks, ids))
                ? null
                : 'Clip restore did not reach the committed owners',
        release: () => {
            release();
            release = () => undefined;
        },
    };
    return {
        validation,
        captureWrittenState: () => {
            expected = readOwners(trackStore.value, ids);
            const restored = expected?.get(action.payload.clipId);
            return restored?.length === 1 && restored[0]?.trackId === action.payload.trackId;
        },
    };
}
