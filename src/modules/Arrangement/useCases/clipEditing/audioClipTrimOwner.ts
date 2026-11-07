import { getObjectId } from '@automerge/automerge';

import { getCrdtDoc, hasForeignPendingProjectWrites } from '#/modules/CrdtDocument/useCases';
import { type HandlerCommitValidation, type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';
import { readTempoMapRows } from '#/utils/tempoMapRowPlan';

import { type Clip } from '../../models/Track';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';

import { audioClipStartTrimState } from './audioClipStartTrimState';
import { audioClipTrimTakeSources } from './audioClipTrimTakeSources';

type Root = Readonly<Record<string, unknown>>;

function rawOwner(root: Root, expected: Clip): Clip | null {
    if (!isRecord(root.tracks) || !Array.isArray(root.tracks.tracks)) {
        return null;
    }
    const owners: { trackId: string; clip: unknown }[] = [];
    for (const track of root.tracks.tracks) {
        if (!isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.clips)) {
            return null;
        }
        for (const clip of track.clips) {
            if (isRecord(clip) && clip.id === expected.id) {
                owners.push({ trackId: track.id, clip });
            }
        }
    }
    const owner = owners[0];
    if (
        owners.length !== 1 ||
        !owner ||
        owner.trackId !== expected.trackId ||
        !isExactClipSnapshot(owner.clip, expected.id, expected.trackId)
    ) {
        return null;
    }
    return audioClipStartTrimState.expectedMatches(owner.clip, expected) ? owner.clip : null;
}

function rawClockMatches(root: Root, clock: TempoSourceClock): boolean {
    const tempo = isRecord(root.transport) ? root.transport.tempo : DEFAULT_TEMPO_BPM;
    const changes = readTempoMapRows(root);
    return Object.is(tempo, clock.tempo) && changes !== null && valuesEqual(changes, clock.changes);
}

function rawTakeSources(root: Root) {
    if (root.takeLanes === undefined) {
        return { lanes: [], identities: new Map<string, string | null>() };
    }
    if (!isRecord(root.takeLanes) || !Array.isArray(root.takeLanes.lanes)) {
        return null;
    }
    const lanes = decodeExactTakeLaneSnapshots(root.takeLanes.lanes);
    if (!lanes) {
        return null;
    }
    const identities = new Map<string, string | null>();
    for (const lane of root.takeLanes.lanes) {
        if (!isRecord(lane) || typeof lane.id !== 'string' || !Array.isArray(lane.takes)) {
            return null;
        }
        identities.set(`lane:${lane.id}`, getObjectId(lane));
        if (!Array.isArray(lane.activeCompRegions)) {
            return null;
        }
        for (const region of lane.activeCompRegions) {
            if (!isRecord(region)) {
                return null;
            }
            identities.set(
                `region:${lane.id}:${JSON.stringify([region.takeId, region.startBeat, region.endBeat])}`,
                getObjectId(region)
            );
        }
        for (const take of lane.takes) {
            if (!isRecord(take) || typeof take.id !== 'string') {
                return null;
            }
            identities.set(`take:${take.id}`, getObjectId(take));
        }
    }
    return { lanes, identities };
}

function takeSourcesMatch(
    root: Root,
    clipId: string,
    transitions: readonly TakeReKeyLaneTransitionSnapshot[] | undefined,
    direction: 'apply' | 'restore'
): boolean {
    if (transitions === undefined) {
        return true;
    }
    const raw = rawTakeSources(root);
    return raw !== null && audioClipTrimTakeSources.matches(raw.lanes, clipId, transitions, direction);
}

function audioClipTrimOwnerMatches(
    expected: Clip,
    clock: TempoSourceClock,
    transitions?: readonly TakeReKeyLaneTransitionSnapshot[],
    direction: 'apply' | 'restore' = 'apply'
): boolean {
    if (hasForeignPendingProjectWrites() || !valuesEqual(audioClipStartTrimState.captureClock(), clock)) {
        return false;
    }
    const target = resolveEligibleClipWriteTarget({ clipId: expected.id });
    if (target.status !== 'eligible' || target.trackId !== expected.trackId) {
        return false;
    }
    const clip = trackStore.value?.tracks
        .find((track) => track.id === expected.trackId)
        ?.clips.find((row) => row.id === expected.id);
    const root = getCrdtDoc<Root>('root');
    return (
        clip !== undefined &&
        audioClipStartTrimState.expectedMatches(clip, expected) &&
        root !== undefined &&
        rawOwner(root, expected) !== null &&
        rawClockMatches(root, clock) &&
        takeSourcesMatch(root, expected.id, transitions, direction) &&
        (transitions === undefined ||
            audioClipTrimTakeSources.matches(takeLaneStore.value?.lanes ?? [], expected.id, transitions, direction))
    );
}

/** Recheck this existing incarnation at the actual publication boundary. */
function captureAudioClipTrimCommitValidation(
    expected: Clip,
    replacement: Clip,
    clock: TempoSourceClock,
    transitions?: readonly TakeReKeyLaneTransitionSnapshot[],
    direction: 'apply' | 'restore' = 'apply'
): HandlerCommitValidation | null {
    const root = getCrdtDoc<Root>('root');
    const owner = root && rawOwner(root, expected);
    const objectId = owner && getObjectId(owner);
    if (!objectId || !root || !rawClockMatches(root, clock)) {
        return null;
    }
    if (!takeSourcesMatch(root, expected.id, transitions, direction)) {
        return null;
    }
    const originalSources = transitions === undefined ? null : rawTakeSources(root);
    const identityKeys = (transitions ?? []).flatMap((lane) => [
        `lane:${lane.laneId}`,
        ...lane.takesBefore.map((take) => `take:${take.id}`),
        ...lane.regionsBefore.map(
            (region) => `region:${lane.laneId}:${JSON.stringify([region.takeId, region.startBeat, region.endBeat])}`
        ),
    ]);
    if (identityKeys.some((key) => !originalSources?.identities.get(key))) {
        return null;
    }
    const matches = (document: Root, clip: Clip, side: 'apply' | 'restore'): boolean => {
        const current = rawOwner(document, clip);
        const sources = transitions === undefined ? null : rawTakeSources(document);
        return (
            current !== null &&
            getObjectId(current) === objectId &&
            rawClockMatches(document, clock) &&
            takeSourcesMatch(document, clip.id, transitions, side) &&
            identityKeys.every((key) => sources?.identities.get(key) === originalSources?.identities.get(key))
        );
    };
    return {
        documentId: 'root',
        beforeCommit: () => {
            const current = getCrdtDoc<Root>('root');
            return current && matches(current, expected, direction) ? null : 'Audio trim owner changed before commit';
        },
        validateDocument: (document) =>
            matches(document, replacement, direction === 'apply' ? 'restore' : 'apply')
                ? null
                : 'Audio trim did not reach its owned source fields',
        release: () => undefined,
    };
}

/** The same scoped owner law at admission and atomic publication. */
export const audioClipTrimOwner = {
    matches: audioClipTrimOwnerMatches,
    captureCommitValidation: captureAudioClipTrimCommitValidation,
};
