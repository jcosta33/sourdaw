import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction, type HandlerCommitValidation } from '#/utils/handlerContract';
import { matchesJsonFingerprint } from '#/utils/jsonSemanticEquality';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { collectClipSplitIdentityIds } from '../../services/collectClipSplitIdentityIds';
import { gainEnvelopeStore } from '../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';
import { discard_warp_states_raw_keys, warpStateStore } from '../../stores/warpStates';

import { identityCounts } from './identityCounts';

type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;
type LocatedClip = { trackId: string; clipIndex: number; clip: Readonly<Record<string, unknown>> };
type Entry = { present: boolean; value?: unknown };
type Programme = { notes: Entry; controllers: Entry; bends: Entry; gain: Entry; warp: Entry };
type ClipOwner = { clips: LocatedClip[]; automation: unknown[]; programme?: Programme };
type Snapshot = {
    owners: Map<string, ClipOwner>;
    identities: Map<string, number>;
    automationLaneIdentities: Map<string, number>;
};

type CapturedSnapshot = Omit<Snapshot, 'owners'> & { owners: Map<string, string> };

function readEntry(slot: unknown, key: string, id: string): Entry {
    if (!isRecord(slot) || !isRecord(slot[key]) || !Object.hasOwn(slot[key], id)) {
        return { present: false };
    }
    return { present: true, value: slot[key][id] };
}

function readSnapshot(
    document: Readonly<Record<string, unknown>>,
    ids: ReadonlySet<string>,
    restoredIds: ReadonlySet<string>,
    childIds: ReadonlySet<string>,
    laneIds: ReadonlySet<string>
): Snapshot | null {
    if (!isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return null;
    }
    const owners = new Map<string, ClipOwner>();
    const lanes: readonly unknown[] =
        isRecord(document.automation) && Array.isArray(document.automation.lanes) ? document.automation.lanes : [];
    const warp = discard_warp_states_raw_keys(document.warpStates);
    for (const id of ids) {
        const scopedLanes = lanes.filter((lane) => isRecord(lane) && lane.clipId === id);
        const orderedLanes = scopedLanes.toSorted((left, right) => {
            if (!isRecord(left) || !isRecord(right)) {
                return 0;
            }
            return String(left.id).localeCompare(String(right.id));
        });
        const owner: ClipOwner = { clips: [], automation: orderedLanes };
        if (restoredIds.has(id)) {
            owner.programme = {
                notes: readEntry(document.midi, 'notesByClipId', id),
                controllers: readEntry(document.midi, 'ccByClipId', id),
                bends: readEntry(document.midi, 'pitchBendByClipId', id),
                gain: readEntry(document.gainEnvelopes, 'envelopes', id),
                warp: readEntry(warp, 'states', id),
            };
        }
        owners.set(id, owner);
    }
    for (const track of document.tracks.tracks) {
        if (!isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.clips)) {
            return null;
        }
        for (const [clipIndex, clip] of track.clips.entries()) {
            if (!isRecord(clip) || typeof clip.id !== 'string') {
                return null;
            }
            const owner = owners.get(clip.id);
            if (owner) {
                owner.clips.push({ trackId: track.id, clipIndex, clip });
            }
        }
    }
    const automationLaneIdentities = new Map<string, number>();
    for (const id of laneIds) {
        automationLaneIdentities.set(id, lanes.filter((lane) => isRecord(lane) && lane.id === id).length);
    }
    return { owners, identities: identityCounts(document, childIds), automationLaneIdentities };
}

function captureSnapshot(snapshot: Snapshot | null): CapturedSnapshot | null {
    if (!snapshot) {
        return null;
    }
    // Capture only bounded owner JSON. Live/prospective values may be Automerge
    // proxies, so retain a serialized witness rather than trying to clone them.
    const owners = new Map<string, string>();
    for (const [id, owner] of snapshot.owners) {
        owners.set(id, JSON.stringify(owner));
    }
    return {
        owners,
        identities: snapshot.identities,
        automationLaneIdentities: snapshot.automationLaneIdentities,
    };
}

function snapshotsMatch(left: CapturedSnapshot | null, right: Snapshot | null): boolean {
    return (
        left !== null &&
        right !== null &&
        [...left.owners].every(([id, fingerprint]) => matchesJsonFingerprint(right.owners.get(id), fingerprint)) &&
        [...left.identities].every(([id, count]) => count === right.identities.get(id)) &&
        [...left.automationLaneIdentities].every(([id, count]) => count === right.automationLaneIdentities.get(id))
    );
}

function projectedDocument(root: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    return {
        ...root,
        tracks: trackStore.value,
        midi: midiStore.value,
        automation: automationStore.value,
        gainEnvelopes: gainEnvelopeStore.value,
        warpStates: warpStateStore.value,
        takeLanes: takeLaneStore.value,
    };
}

function refreshExpectedSnapshot(
    expected: CapturedSnapshot,
    observed: CapturedSnapshot,
    next: Snapshot,
    ids: ReadonlySet<string>,
    childIds: ReadonlySet<string>,
    laneIds: ReadonlySet<string>
): void {
    for (const id of ids) {
        const nextOwner = next.owners.get(id);
        const previousFingerprint = observed.owners.get(id);
        if (nextOwner && previousFingerprint !== undefined && !matchesJsonFingerprint(nextOwner, previousFingerprint)) {
            expected.owners.set(id, JSON.stringify(nextOwner));
        }
    }
    for (const id of childIds) {
        const count = next.identities.get(id);
        if (count !== undefined && observed.identities.get(id) !== count) {
            expected.identities.set(id, count);
        }
    }
    for (const id of laneIds) {
        const count = next.automationLaneIdentities.get(id);
        if (count !== undefined && observed.automationLaneIdentities.get(id) !== count) {
            expected.automationLaneIdentities.set(id, count);
        }
    }
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
    const restoredIds = new Set(
        action.payload.ripplePlan?.removedClips.map((clip) => clip.id) ?? [action.payload.clipId]
    );
    const ids = new Set(restoredIds);
    for (const shifted of action.payload.ripplePlan?.shiftedClips ?? []) {
        ids.add(shifted.clipId);
    }
    const childIds = new Set(
        collectClipSplitIdentityIds([
            action.payload.midiNotesSnapshot,
            action.payload.midiCcSnapshot,
            action.payload.midiPitchBendSnapshot,
        ])
    );
    const laneIds = new Set(action.payload.ripplePlan?.clipAutomationLanes.map((lane) => lane.id) ?? []);
    const read = (document: Readonly<Record<string, unknown>>) =>
        readSnapshot(document, ids, restoredIds, childIds, laneIds);
    const before = captureSnapshot(read(root));
    let observed = captureSnapshot(read(projectedDocument(root)));
    let expected: CapturedSnapshot | null = null;
    let observedHeads = getHeads(root).toSorted();
    let authorityIntervened = false;
    const observe = (): void => {
        const currentRoot = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
        if (!currentRoot) {
            observed = null;
            authorityIntervened = true;
            return;
        }
        const next = read(projectedDocument(currentRoot));
        const nextHeads = getHeads(currentRoot).toSorted();
        authorityIntervened ||= !valuesEqual(observedHeads, nextHeads);
        // A publication may hydrate under an entered owner scope, even after
        // another notification observed its heads. Refresh the baseline only;
        // prospective owner checks still admit an effect that survived it.
        if (
            expected &&
            observed &&
            next &&
            !authorityIntervened &&
            getCurrentAutomergeStorageMutationOwner() === owner
        ) {
            refreshExpectedSnapshot(expected, observed, next, ids, childIds, laneIds);
        }
        observed = captureSnapshot(next);
        observedHeads = nextHeads;
    };
    const releases = [
        trackStore.subscribe(observe),
        midiStore.subscribe(observe),
        automationStore.subscribe(observe),
        gainEnvelopeStore.subscribe(observe),
        warpStateStore.subscribe(observe),
        takeLaneStore.subscribe(observe),
    ];
    const validation: HandlerCommitValidation = {
        beforeCommit: () => {
            const current = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
            return current && snapshotsMatch(before, read(current))
                ? null
                : 'Clip restore owners changed before commit';
        },
        documentId: 'root',
        validateDocument: (document) =>
            snapshotsMatch(expected, read(document)) ? null : 'Clip restore did not reach the committed owners',
        release: () => {
            for (const release of releases.splice(0)) {
                release();
            }
        },
    };
    return {
        validation,
        captureWrittenState: () => {
            const current = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
            const next = current ? read(projectedDocument(current)) : null;
            expected = captureSnapshot(next);
            const restored = next?.owners.get(action.payload.clipId)?.clips;
            return restored?.length === 1 && restored[0]?.trackId === action.payload.trackId;
        },
    };
}
