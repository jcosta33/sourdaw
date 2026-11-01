import { getObjectId } from '@automerge/automerge';

import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { type HandlerCommitValidation } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';

import { type TakeLane } from '../../models/TakeLane';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import { updateClip } from '../updateClip';

import { audioClipSlipState } from './audioClipSlipState';
import { audioClipTrimOwner } from './audioClipTrimOwner';
import { type AudioClipSlipSnapshot } from './prepareAudioClipSlip';

type Root = Readonly<Record<string, unknown>>;

function rawLanes(root: Root, expected: AudioClipSlipSnapshot): TakeLane[] | null {
    if (!Object.hasOwn(root, 'takeLanes')) {
        return [];
    }
    if (!isRecord(root.takeLanes) || !Array.isArray(root.takeLanes.lanes)) {
        return null;
    }
    return decodeExactTakeLaneSnapshots(
        root.takeLanes.lanes.filter((lane) => isRecord(lane) && lane.trackId === expected.clip.trackId)
    );
}

function rawMatches(root: Root, expected: AudioClipSlipSnapshot): boolean {
    const lanes = rawLanes(root, expected);
    return lanes !== null && audioClipSlipState.lanesMatch(lanes, expected);
}

function incarnations(root: Root, expected: AudioClipSlipSnapshot): readonly string[] | null {
    if (!isRecord(root.takeLanes) || !Array.isArray(root.takeLanes.lanes)) {
        return expected.lanes.length === 0 ? [] : null;
    }
    const objects: (string | null | undefined)[] = [];
    for (const captured of expected.lanes) {
        const matches = root.takeLanes.lanes.filter(
            (row) => isRecord(row) && row.id === captured.id && row.trackId === captured.trackId
        );
        const lane: unknown = matches.length === 1 ? matches[0] : undefined;
        if (!isRecord(lane) || !Array.isArray(lane.takes) || !Array.isArray(lane.activeCompRegions)) {
            return null;
        }
        objects.push(getObjectId(lane));
        const ids = new Set(captured.takes.filter((take) => take.clipId === expected.clip.id).map((take) => take.id));
        for (const take of lane.takes) {
            if (isRecord(take) && ids.has(String(take.id))) {
                objects.push(getObjectId(take));
            }
        }
        for (const region of lane.activeCompRegions) {
            if (isRecord(region) && ids.has(String(region.takeId))) {
                objects.push(getObjectId(region));
            }
        }
        if (Array.isArray(lane.baseGapAudioSources)) {
            for (const tile of lane.baseGapAudioSources) {
                if (isRecord(tile) && tile.clipId === expected.clip.id) {
                    objects.push(getObjectId(tile));
                }
            }
        }
    }
    return objects.every((id): id is string => typeof id === 'string') ? objects : null;
}

function matches(expected: AudioClipSlipSnapshot, clock: TempoSourceClock): boolean {
    const root = getCrdtDoc<Root>('root');
    return (
        audioClipTrimOwner.matches(expected.clip, clock) &&
        root !== undefined &&
        audioClipSlipState.lanesMatch(takeLaneStore.value?.lanes ?? [], expected) &&
        rawMatches(root, expected)
    );
}

function captureCommitValidation(
    expected: AudioClipSlipSnapshot,
    replacement: AudioClipSlipSnapshot,
    clock: TempoSourceClock
): HandlerCommitValidation | null {
    const clipProof = audioClipTrimOwner.captureCommitValidation(expected.clip, replacement.clip, clock);
    const root = getCrdtDoc<Root>('root');
    const owners = root && incarnations(root, expected);
    if (!clipProof || !root || !owners || !rawMatches(root, expected)) {
        clipProof?.release();
        return null;
    }
    return {
        documentId: 'root',
        beforeCommit: () => {
            const failure = clipProof.beforeCommit();
            if (failure) {
                return failure;
            }
            const current = getCrdtDoc<Root>('root');
            return current && rawMatches(current, expected) && valuesEqual(incarnations(current, expected), owners)
                ? null
                : 'Audio slip source owner changed before commit';
        },
        validateDocument: (document) =>
            clipProof.validateDocument(document) ??
            (rawMatches(document, replacement) ? null : 'Audio slip did not reach its owned programme'),
        release: clipProof.release,
    };
}

function write(expected: AudioClipSlipSnapshot, replacement: AudioClipSlipSnapshot): boolean {
    const state = takeLaneStore.value;
    const lanes = audioClipSlipState.projectLanes(state?.lanes ?? [], expected, replacement);
    if (!lanes) {
        return false;
    }
    const written = updateClip(expected.clip.id, (clip) => audioClipSlipState.projectClip(clip, replacement.clip));
    if (!written) {
        return false;
    }
    if (state && !valuesEqual(state.lanes, lanes)) {
        takeLaneStore.set({ ...state, lanes });
    }
    return true;
}

export const audioClipSlipOwner = { matches, captureCommitValidation, write };
