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

type SplitAction = Extract<AppAction, { type: 'restoreClipSplitState' }>;
type Document = Readonly<Record<string, unknown>>;
type Snapshot = Map<string, unknown>;
type CapturedSnapshot = Map<string, string>;

function entry(slot: unknown, key: string, id: string): unknown {
    if (!isRecord(slot) || !isRecord(slot[key]) || !Object.hasOwn(slot[key], id)) {
        return { present: false };
    }
    return { present: true, value: slot[key][id] };
}

function takeMaterial(document: Document, takeId: string): unknown {
    const lanes =
        isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
    return Array.from(lanes).flatMap((lane) => {
        if (!isRecord(lane) || !Array.isArray(lane.takes)) {
            return [];
        }
        const takes: readonly unknown[] = lane.takes;
        const matching = Array.from(takes).filter((take) => isRecord(take) && take.id === takeId);
        if (matching.length === 0) {
            return [];
        }
        let regions: readonly unknown[] = [];
        if (Array.isArray(lane.activeCompRegions)) {
            regions = Array.from(lane.activeCompRegions);
        }
        const ownedFacets = matching.map((take) => {
            if (!isRecord(take)) {
                return take;
            }
            return Object.fromEntries(Object.entries(take).filter(([key]) => key !== 'selected'));
        });
        return [
            {
                laneId: lane.id,
                trackId: lane.trackId,
                takes: ownedFacets,
                regions: regions.filter((region) => isRecord(region) && region.takeId === takeId),
            },
        ];
    });
}

function rightTakeMaterial(document: Document, rightClipId: string): unknown {
    const lanes =
        isRecord(document.takeLanes) && Array.isArray(document.takeLanes.lanes) ? document.takeLanes.lanes : [];
    return Array.from(lanes).flatMap((lane) => {
        if (!isRecord(lane) || !Array.isArray(lane.takes)) {
            return [];
        }
        const takes: readonly unknown[] = lane.takes;
        const matching = Array.from(takes).filter((take) => isRecord(take) && take.clipId === rightClipId);
        if (matching.length === 0) {
            return [];
        }
        const takeIds = new Set<string>();
        for (const take of matching) {
            if (!isRecord(take)) {
                continue;
            }
            const id = take.id;
            if (typeof id === 'string') {
                takeIds.add(id);
            }
        }
        let regions: readonly unknown[] = [];
        if (Array.isArray(lane.activeCompRegions)) {
            regions = Array.from(lane.activeCompRegions);
        }
        return [
            {
                laneId: lane.id,
                trackId: lane.trackId,
                automationLaneId: lane.automationLaneId,
                takes: matching,
                regions: regions.filter(
                    (region) => isRecord(region) && typeof region.takeId === 'string' && takeIds.has(region.takeId)
                ),
            },
        ];
    });
}

function readSnapshot(
    document: Document,
    clipIds: readonly string[],
    satelliteIds: ReadonlySet<string>,
    rightClipId: string,
    writesAutomation: boolean,
    childIds: ReadonlySet<string>,
    laneIds: ReadonlySet<string>,
    takeIds: ReadonlySet<string>
): Snapshot | null {
    if (!isRecord(document.tracks) || !Array.isArray(document.tracks.tracks)) {
        return null;
    }
    const snapshot: Snapshot = new Map();
    const tracks: readonly unknown[] = document.tracks.tracks;
    const automation: readonly unknown[] =
        isRecord(document.automation) && Array.isArray(document.automation.lanes) ? document.automation.lanes : [];
    const warp = discard_warp_states_raw_keys(document.warpStates);
    for (const id of clipIds) {
        const clips: unknown[] = [];
        for (const track of tracks) {
            if (!isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.clips)) {
                return null;
            }
            const trackClips: readonly unknown[] = track.clips;
            for (let index = 0; index < trackClips.length; index += 1) {
                const clip = trackClips[index];
                if (isRecord(clip) && clip.id === id) {
                    clips.push({ trackId: track.id, index, clip });
                }
            }
        }
        snapshot.set(`clip:${id}`, clips);
        snapshot.set(`notes:${id}`, entry(document.midi, 'notesByClipId', id));
        snapshot.set(`cc:${id}`, entry(document.midi, 'ccByClipId', id));
        snapshot.set(`bends:${id}`, entry(document.midi, 'pitchBendByClipId', id));
        if (satelliteIds.has(id)) {
            snapshot.set(`gain:${id}`, entry(document.gainEnvelopes, 'envelopes', id));
            snapshot.set(`warp:${id}`, entry(warp, 'states', id));
        }
    }
    if (writesAutomation) {
        const matchingAutomationLanes = automation.filter(
            (lane): lane is Record<string, unknown> => isRecord(lane) && lane.clipId === rightClipId
        );
        const orderedAutomationLanes = matchingAutomationLanes.toSorted((a, b) =>
            String(a.id).localeCompare(String(b.id))
        );
        snapshot.set(`automation:${rightClipId}`, orderedAutomationLanes);
    }
    for (const [id, count] of identityCounts(document, childIds)) {
        snapshot.set(`identity:${id}`, count);
    }
    for (const id of laneIds) {
        snapshot.set(`laneIdentity:${id}`, automation.filter((lane) => isRecord(lane) && lane.id === id).length);
    }
    for (const id of takeIds) {
        snapshot.set(`take:${id}`, takeMaterial(document, id));
    }
    snapshot.set(`rightTakes:${rightClipId}`, rightTakeMaterial(document, rightClipId));
    return snapshot;
}

function capture(snapshot: Snapshot | null): CapturedSnapshot | null {
    if (!snapshot) {
        return null;
    }
    const captured: CapturedSnapshot = new Map();
    for (const [key, value] of snapshot) {
        const fingerprint = JSON.stringify(value);
        if (fingerprint === undefined) {
            return null;
        }
        captured.set(key, fingerprint);
    }
    return captured;
}

function matches(captured: CapturedSnapshot | null, live: Snapshot | null): boolean {
    return (
        captured !== null &&
        live !== null &&
        [...captured].every(([key, value]) => matchesJsonFingerprint(live.get(key), value))
    );
}

function projectedDocument(root: Document): Document {
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

function changedTakeIds(payload: SplitAction['payload']): Set<string> {
    const takeIds = new Set((payload.retiredTakeLanes ?? []).flatMap((lane) => lane.retiredTakeIds ?? []));
    for (const lane of payload.reKeyedTakeLanes ?? []) {
        const beforeTakes = new Map(lane.takesBefore.map((take) => [take.id, take]));
        const afterTakes = new Map(lane.takesAfter.map((take) => [take.id, take]));
        for (const id of new Set([...beforeTakes.keys(), ...afterTakes.keys()])) {
            const before = beforeTakes.get(id);
            const after = afterTakes.get(id);
            const ownedBefore = before && { ...before, selected: undefined };
            const ownedAfter = after && { ...after, selected: undefined };
            if (!valuesEqual(ownedBefore, ownedAfter)) {
                takeIds.add(id);
            }
        }
        for (const id of new Set([...lane.regionsBefore, ...lane.regionsAfter].map((region) => region.takeId))) {
            if (
                !valuesEqual(
                    lane.regionsBefore.filter((region) => region.takeId === id),
                    lane.regionsAfter.filter((region) => region.takeId === id)
                )
            ) {
                takeIds.add(id);
            }
        }
    }
    return takeIds;
}

function capturedChildIds(payload: SplitAction['payload']): Set<string> {
    const { expected, replacement, reKeyedTakeLanes, retiredTakeLanes } = payload;
    return new Set(
        collectClipSplitIdentityIds([
            expected.sourceMidi,
            expected.rightMidi,
            replacement.sourceMidi,
            replacement.rightMidi,
            expected.clipAutomationLanes,
            replacement.clipAutomationLanes,
            reKeyedTakeLanes,
            retiredTakeLanes,
        ])
    );
}

/** Authenticate the raw owners admitted by split replay and the exact owners its staged write intends to commit. */
export function captureRestoreClipSplitCommitValidation(
    action: SplitAction
): { validation: HandlerCommitValidation; captureWrittenState: () => boolean } | undefined {
    const owner = getCurrentAutomergeStorageMutationOwner();
    const root = getCrdtDoc<Document>('root');
    if (!owner || !root) {
        return undefined;
    }
    const { clipId, rightClipId, expected, replacement } = action.payload;
    const clipIds = [clipId, rightClipId];
    const expectedSatellites = expected.clipSatellites ?? [];
    const replacementSatellites = replacement.clipSatellites ?? [];
    const satelliteIds = new Set(
        [...expectedSatellites, ...replacementSatellites].map((satellite) => satellite.clipId)
    );
    const writesAutomation = expected.clipAutomationLanes !== undefined;
    const childIds = capturedChildIds(action.payload);
    const expectedAutomationLanes = expected.clipAutomationLanes ?? [];
    const replacementAutomationLanes = replacement.clipAutomationLanes ?? [];
    const laneIds = new Set([...expectedAutomationLanes, ...replacementAutomationLanes].map((lane) => lane.id));
    const takeIds = changedTakeIds(action.payload);
    const read = (document: Document) =>
        readSnapshot(document, clipIds, satelliteIds, rightClipId, writesAutomation, childIds, laneIds, takeIds);
    const before = capture(read(root));
    let observed = capture(read(projectedDocument(root)));
    let expectedOwner: CapturedSnapshot | null = null;
    let observedHeads = getHeads(root).toSorted();
    let authorityIntervened = false;
    const observe = (): void => {
        const current = getCrdtDoc<Document>('root');
        if (!current) {
            observed = null;
            authorityIntervened = true;
            return;
        }
        const next = read(projectedDocument(current));
        const nextHeads = getHeads(current).toSorted();
        authorityIntervened ||= !valuesEqual(observedHeads, nextHeads);
        if (
            expectedOwner &&
            observed &&
            next &&
            !authorityIntervened &&
            getCurrentAutomergeStorageMutationOwner() === owner
        ) {
            for (const [key, value] of next) {
                if (!matchesJsonFingerprint(value, observed.get(key) ?? 'null')) {
                    const fingerprint = JSON.stringify(value);
                    if (fingerprint !== undefined) {
                        expectedOwner.set(key, fingerprint);
                    }
                }
            }
        }
        observed = capture(next);
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
            const current = getCrdtDoc<Document>('root');
            return current && matches(before, read(current)) ? null : 'Clip split owners changed before commit';
        },
        documentId: 'root',
        validateDocument: (document) =>
            matches(expectedOwner, read(document)) ? null : 'Clip split did not reach the committed owners',
        release: () => {
            for (const release of releases.splice(0)) {
                release();
            }
        },
    };
    return {
        validation,
        captureWrittenState: () => {
            const current = getCrdtDoc<Document>('root');
            const next = current ? read(projectedDocument(current)) : null;
            expectedOwner = capture(next);
            const clips = next?.get(`clip:${clipId}`);
            return (
                Array.isArray(clips) &&
                clips.length === 1 &&
                isRecord(clips[0]) &&
                clips[0].trackId === replacement.trackId
            );
        },
    };
}
