import { change, clone as cloneDoc, getHeads, type Doc } from '@automerge/automerge';

import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { projectDrumPreviewCandidateNotes } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchRecord } from '../../stores/branchStore';

type CreateDrumPreviewBranchesAction = Extract<AppAction, { type: 'createDrumPreviewBranches' }>;

type PreparedDrumPreviewBranch = {
    doc: Doc<Record<string, unknown>>;
    expectedHeads: string[];
    record: BranchRecord;
};

export type PreparedDrumPreviewBranches = {
    action: CreateDrumPreviewBranchesAction;
    branches: PreparedDrumPreviewBranch[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeJsonValue);
    }
    if (!isRecord(value)) {
        return value;
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
        normalized[key] = normalizeJsonValue(value[key]);
    }
    return normalized;
}

function snapshotsEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(normalizeJsonValue(left)) === JSON.stringify(normalizeJsonValue(right));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getCandidateActorId(branchId: string): string | null {
    const actorId = branchId.replaceAll('-', '');
    return /^[0-9a-f]{32}$/u.test(actorId) ? actorId : null;
}

function hasExactSourceClip(snapshot: CreateDrumPreviewBranchesAction['payload']['kick']): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const trackMatches = tracks.filter(({ id }) => id === snapshot.trackId);
    if (trackMatches.length !== 1) {
        return false;
    }
    const track = trackMatches[0]!;
    const clipMatches = track.clips.filter(({ id }) => id === snapshot.clipId);
    if (
        track.kind !== 'midi' ||
        track.name !== snapshot.trackName ||
        track.frozen !== snapshot.expectedTrackFrozen ||
        clipMatches.length !== 1 ||
        clipMatches[0]!.type !== 'midi' ||
        clipMatches[0]!.name !== snapshot.clipName ||
        clipMatches[0]!.locked !== snapshot.expectedClipLocked ||
        !snapshotsEqual(midiStore.value?.notesByClipId[snapshot.clipId] ?? [], snapshot.expectedNotes)
    ) {
        return false;
    }
    return true;
}

function hasValidPlanShape(action: CreateDrumPreviewBranchesAction): boolean {
    const { payload } = action;
    const expectedRecipes = ['ghost-note-pocket', 'half-time-space', 'syncopated-hats'] as const;
    const expectedNames = [
        'Drum Candidate 1 — Ghost-note Pocket',
        'Drum Candidate 2 — Half-time Space',
        'Drum Candidate 3 — Syncopated Hats',
    ] as const;
    return (
        payload.ownerId.length > 0 &&
        Number.isFinite(payload.createdAt) &&
        payload.expectedSourceBranchId.length > 0 &&
        payload.expectedBranchState.activeBranchId === payload.expectedSourceBranchId &&
        payload.expectedDocuments.length > 0 &&
        new Set(payload.expectedDocuments.map(({ docId }) => docId)).size === payload.expectedDocuments.length &&
        payload.expectedDocuments.some(({ docId }) => docId === DOC_PREFIX_ROOT) &&
        payload.sectionId.length > 0 &&
        payload.sectionName.length > 0 &&
        Number.isFinite(payload.sectionStartBeat) &&
        Number.isFinite(payload.sectionEndBeat) &&
        payload.sectionEndBeat > payload.sectionStartBeat &&
        payload.candidates.length === 3 &&
        new Set(payload.candidates.map(({ branchId }) => branchId)).size === 3 &&
        new Set(payload.candidates.map(({ rootDocId }) => rootDocId)).size === 3 &&
        payload.candidates.every(
            (candidate, index) =>
                candidate.branchId.length > 0 &&
                getCandidateActorId(candidate.branchId) !== null &&
                candidate.rootDocId === `branch_${candidate.branchId}` &&
                candidate.recipe === expectedRecipes[index] &&
                candidate.branchName === expectedNames[index]
        )
    );
}

function hasExactDocumentSnapshot(
    action: CreateDrumPreviewBranchesAction,
    allowedAdditionalDocIds: readonly string[] = []
): boolean {
    const expectedDocIds = action.payload.expectedDocuments.map(({ docId }) => docId);
    const expectedLiveDocIds = [...expectedDocIds, ...allowedAdditionalDocIds].toSorted();
    if (!arraysEqual(automergeRepository.getDocIds().toSorted(), expectedLiveDocIds)) {
        return false;
    }
    return action.payload.expectedDocuments.every(({ docId, heads }) => {
        const liveHeads = [...(automergeRepository.getHeads(docId) ?? [])].map(String).toSorted();
        return arraysEqual(liveHeads, heads);
    });
}

function buildPreparedBranches(
    action: CreateDrumPreviewBranchesAction,
    sourceDoc: Doc<Record<string, unknown>>
): PreparedDrumPreviewBranches | null {
    const { payload } = action;
    const midiState = midiStore.value;
    if (!midiState) {
        return null;
    }
    const branches: PreparedDrumPreviewBranch[] = [];
    for (const candidate of payload.candidates) {
        const actorId = getCandidateActorId(candidate.branchId);
        if (!actorId) {
            return null;
        }
        const snareNotes = projectDrumPreviewCandidateNotes({
            branchId: candidate.branchId,
            endBeat: payload.sectionEndBeat,
            notes: payload.snare.expectedNotes,
            recipe: candidate.recipe,
            role: 'snare',
            startBeat: payload.sectionStartBeat,
        });
        const hiHatNotes = projectDrumPreviewCandidateNotes({
            branchId: candidate.branchId,
            endBeat: payload.sectionEndBeat,
            notes: payload.hiHat.expectedNotes,
            recipe: candidate.recipe,
            role: 'hi-hat',
            startBeat: payload.sectionStartBeat,
        });
        if (
            !snareNotes ||
            !hiHatNotes ||
            !snapshotsEqual(snareNotes, candidate.snareNotes) ||
            !snapshotsEqual(hiHatNotes, candidate.hiHatNotes)
        ) {
            return null;
        }

        const candidateMidiState = structuredClone(midiState);
        candidateMidiState.notesByClipId[payload.snare.clipId] = candidate.snareNotes.map((note) => ({ ...note }));
        candidateMidiState.notesByClipId[payload.hiHat.clipId] = candidate.hiHatNotes.map((note) => ({ ...note }));
        const doc = change(
            cloneDoc(sourceDoc, actorId),
            { message: `Create ${candidate.branchName}`, time: 0 },
            (draft) => {
                draft.midi = candidateMidiState;
            }
        );
        branches.push({
            doc,
            expectedHeads: getHeads(doc).map(String).toSorted(),
            record: {
                branchId: candidate.branchId,
                name: candidate.branchName,
                rootDocId: candidate.rootDocId,
                sourceBranchId: payload.expectedSourceBranchId,
                createdAt: payload.createdAt,
                createdFromHeads: [...payload.expectedSourceHeads],
                note: `agent-preview:${payload.ownerId}`,
            },
        });
    }
    return { action, branches };
}

export function prepareDrumPreviewBranches(
    action: CreateDrumPreviewBranchesAction
): PreparedDrumPreviewBranches | null {
    const { payload } = action;
    const state = branchStore.value;
    const sourceDoc = automergeRepository.getDoc<Record<string, unknown>>(DOC_PREFIX_ROOT);
    const sourceHeads = [...(automergeRepository.getHeads(DOC_PREFIX_ROOT) ?? [])].map(String).toSorted();
    if (
        !state ||
        !sourceDoc ||
        !hasValidPlanShape(action) ||
        !snapshotsEqual(state, payload.expectedBranchState) ||
        !hasExactDocumentSnapshot(action) ||
        state.activeBranchId !== payload.expectedSourceBranchId ||
        !arraysEqual(sourceHeads, payload.expectedSourceHeads) ||
        state.branches.some(({ branchId }) =>
            payload.candidates.some((candidate) => candidate.branchId === branchId)
        ) ||
        payload.candidates.some(({ rootDocId }) => automergeRepository.hasDoc(rootDocId)) ||
        !hasExactSourceClip(payload.kick) ||
        !hasExactSourceClip(payload.snare) ||
        !hasExactSourceClip(payload.hiHat)
    ) {
        return null;
    }
    return buildPreparedBranches(action, sourceDoc);
}
