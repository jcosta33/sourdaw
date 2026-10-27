import { getObjectId } from '@automerge/automerge';

import { getCrdtDoc, hasForeignPendingProjectWrites } from '#/modules/CrdtDocument/useCases';
import { type HandlerCommitValidation } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';
import { readTempoMapRows } from '#/utils/tempoMapRowPlan';
import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';

import { type Clip } from '../../models/Track';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

import { audioClipTrimExpectedMatches, captureAudioClipTrimClock } from './audioClipStartTrimState';

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
    if (owners.length !== 1 || !owner || owner.trackId !== expected.trackId ||
        !isExactClipSnapshot(owner.clip, expected.id, expected.trackId)) {
        return null;
    }
    return audioClipTrimExpectedMatches(owner.clip, expected) ? owner.clip : null;
}

function rawClockMatches(root: Root, clock: TempoSourceClock): boolean {
    const tempo = isRecord(root.transport) ? root.transport.tempo : DEFAULT_TEMPO_BPM;
    const changes = readTempoMapRows(root);
    return Object.is(tempo, clock.tempo) && changes !== null && valuesEqual(changes, clock.changes);
}

export function audioClipTrimOwnerMatches(expected: Clip, clock: TempoSourceClock): boolean {
    if (hasForeignPendingProjectWrites() || !valuesEqual(captureAudioClipTrimClock(), clock)) {
        return false;
    }
    const target = resolveEligibleClipWriteTarget({ clipId: expected.id });
    if (target.status !== 'eligible' || target.trackId !== expected.trackId) {
        return false;
    }
    const clip = trackStore.value?.tracks.find((track) => track.id === expected.trackId)?.clips.find((row) => row.id === expected.id);
    const root = getCrdtDoc<Root>('root');
    return clip !== undefined && audioClipTrimExpectedMatches(clip, expected) && root !== undefined &&
        rawOwner(root, expected) !== null && rawClockMatches(root, clock);
}

/** Recheck this existing incarnation at the actual publication boundary. */
export function captureAudioClipTrimCommitValidation(
    expected: Clip,
    replacement: Clip,
    clock: TempoSourceClock
): HandlerCommitValidation | null {
    const root = getCrdtDoc<Root>('root');
    const owner = root && rawOwner(root, expected);
    const objectId = owner && getObjectId(owner);
    if (!objectId || !root || !rawClockMatches(root, clock)) {
        return null;
    }
    const matches = (document: Root, clip: Clip): boolean => {
        const current = rawOwner(document, clip);
        return current !== null && getObjectId(current) === objectId && rawClockMatches(document, clock);
    };
    return {
        documentId: 'root',
        beforeCommit: () => {
            const current = getCrdtDoc<Root>('root');
            return current && matches(current, expected) ? null : 'Audio trim owner changed before commit';
        },
        validateDocument: (document) => matches(document, replacement) ? null : 'Audio trim did not reach its owned source fields',
        release: () => undefined,
    };
}
