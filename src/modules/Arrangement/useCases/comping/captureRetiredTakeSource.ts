import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import {
    getCrdtDoc,
    stageCommandSourcePublication,
    commandSourcePublicationMatches,
} from '#/modules/CrdtDocument/useCases';
import {
    type CommandSourceProof,
    type HandlerCommitValidation,
    type RetiredTakeLaneSnapshot,
} from '#/utils/handlerContract';
import { matchesJsonFingerprint } from '#/utils/jsonSemanticEquality';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';

type SourceKind = 'removeClip' | 'splitClipUndo';

function sourceOwners(clipIds: readonly string[], captures: readonly RetiredTakeLaneSnapshot[], undoEntryId: string) {
    // Restoration consumes media, selection, comp regions and lane placement,
    // not just identities. Match the saved JSON shape before canonical hashing.
    const owners: unknown = JSON.parse(JSON.stringify(captures));
    return { undoEntryId, clipIds: [...clipIds], owners };
}

export function retiredTakeSourceMatches(
    kind: SourceKind,
    clipIds: readonly string[],
    captures: readonly RetiredTakeLaneSnapshot[],
    reference: unknown,
    undoEntryId: string | undefined
): boolean {
    // Empty producer placeholders and legacy omissions carry no issued proof.
    // Once issued, evidence authenticates the exact capture, even an empty one.
    const proofless =
        reference === undefined ||
        (isRecord(reference) &&
            Object.keys(reference).length === 2 &&
            reference.changeHash === '' &&
            reference.memberId === '');
    return (
        (captures.length === 0 && proofless) ||
        (typeof undoEntryId === 'string' &&
            commandSourcePublicationMatches(kind, sourceOwners(clipIds, captures, undoEntryId), reference))
    );
}

/** Capture only from the actual retirement plan in an entered owner scope. */
export function captureRetiredTakeSource(
    kind: SourceKind,
    clipIds: readonly string[],
    captures: readonly RetiredTakeLaneSnapshot[],
    reference: CommandSourceProof,
    undoEntryId: string | undefined
): { validation: HandlerCommitValidation; captureWrittenState: () => boolean } | undefined {
    const owner = getCurrentAutomergeStorageMutationOwner();
    const root = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
    if (!owner || !root || captures.length === 0 || undoEntryId === undefined) {
        return undefined;
    }
    const laneIds = new Set(captures.map(({ lane }) => lane.id));
    const takeIds = new Set(captures.flatMap(({ retiredTakeIds }) => retiredTakeIds ?? []));
    const hostIds = new Set(captures.map(({ lane }) => lane.trackId));
    const read = (document: Readonly<Record<string, unknown>>) => {
        const lanes =
            isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
        const tracks = isRecord(document.tracks) && Array.isArray(document.tracks.tracks) ? document.tracks.tracks : [];
        return {
            lanes: Array.from(lanes).filter(
                (lane) =>
                    isRecord(lane) &&
                    ((typeof lane.id === 'string' && laneIds.has(lane.id)) ||
                        (Array.isArray(lane.takes) &&
                            lane.takes.some(
                                (take) => isRecord(take) && typeof take.id === 'string' && takeIds.has(take.id)
                            )))
            ),
            hosts: Array.from(tracks)
                .filter((track) => isRecord(track) && typeof track.id === 'string' && hostIds.has(track.id))
                .map((track) => (isRecord(track) ? track.id : null)),
        };
    };
    const projected = () => read({ ...getCrdtDoc('root'), takeLanes: takeLaneStore.value, tracks: trackStore.value });
    const before = JSON.stringify(read(root));
    let observed = JSON.stringify(projected());
    let expected: string | undefined;
    let heads = getHeads(root).toSorted();
    let intervened = false;
    const observe = () => {
        const current = getCrdtDoc('root');
        const next = projected();
        const nextHeads = current ? getHeads(current).toSorted() : [];
        intervened ||= !current || !valuesEqual(heads, nextHeads);
        if (
            expected !== undefined &&
            !intervened &&
            getCurrentAutomergeStorageMutationOwner() === owner &&
            !matchesJsonFingerprint(next, observed)
        ) {
            expected = JSON.stringify(next);
        }
        observed = JSON.stringify(next);
        heads = nextHeads;
    };
    const releases = [takeLaneStore.subscribe(observe), trackStore.subscribe(observe)];
    const sourceUnchanged = () => {
        const current = getCrdtDoc('root');
        return current !== undefined && matchesJsonFingerprint(read(current), before);
    };
    let publish: () => void;
    try {
        publish = stageCommandSourcePublication(kind, sourceOwners(clipIds, captures, undoEntryId), reference);
    } catch (error) {
        for (const release of releases) {
            release();
        }
        throw error;
    }
    return {
        captureWrittenState: () => {
            const next = projected();
            expected = JSON.stringify(next);
            return !next.lanes.some(
                (lane) =>
                    isRecord(lane) &&
                    Array.isArray(lane.takes) &&
                    lane.takes.some((take) => isRecord(take) && typeof take.id === 'string' && takeIds.has(take.id))
            );
        },
        validation: {
            documentId: 'root',
            beforeCommit: () => (sourceUnchanged() ? null : 'Retired take source owners changed before commit'),
            validateDocument: (document) =>
                // The repository still exposes the draft's authoritative basis
                // here. A last-moment source change cannot be authenticated just
                // because this retirement erased every trace of its wrong owner.
                sourceUnchanged() && expected !== undefined && matchesJsonFingerprint(read(document), expected)
                    ? null
                    : 'Retired take source effect did not reach committed owners',
            release: () => {
                for (const release of releases.splice(0)) {
                    release();
                }
            },
            afterPublication: publish,
        },
    };
}
