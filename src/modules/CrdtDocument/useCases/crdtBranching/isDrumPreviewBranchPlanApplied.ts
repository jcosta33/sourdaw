import { logger } from '#/infra/logger/appLogger';
import { type AppAction } from '#/utils/handlerContract';

import { DOC_BRANCHES, DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchRecord } from '../../stores/branchStore';

type CreateDrumPreviewBranchesAction = Extract<AppAction, { type: 'createDrumPreviewBranches' }>;

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

function toPlainRecord(value: unknown): Record<string, unknown> | null {
    const parsed: unknown = JSON.parse(JSON.stringify(value));
    return isRecord(parsed) ? parsed : null;
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
                /^[0-9a-f]{32}$/u.test(candidate.branchId.replaceAll('-', '')) &&
                candidate.rootDocId === `branch_${candidate.branchId}` &&
                candidate.recipe === expectedRecipes[index] &&
                candidate.branchName === expectedNames[index]
        )
    );
}

function hasExactDocumentSnapshot(
    action: CreateDrumPreviewBranchesAction,
    allowedAdditionalDocIds: readonly string[]
): boolean {
    const expectedDocIds = action.payload.expectedDocuments.map(({ docId }) => docId);
    const expectedLiveDocIds = [...expectedDocIds, ...allowedAdditionalDocIds].toSorted();
    if (!arraysEqual(automergeRepository.getDocIds().toSorted(), expectedLiveDocIds)) {
        return false;
    }
    return action.payload.expectedDocuments.every(({ docId, heads }) => {
        if (docId === DOC_BRANCHES) {
            return true;
        }
        const liveHeads = [...(automergeRepository.getHeads(docId) ?? [])].map(String).toSorted();
        return arraysEqual(liveHeads, heads);
    });
}

function hasExactCandidateDocument(
    action: CreateDrumPreviewBranchesAction,
    candidate: CreateDrumPreviewBranchesAction['payload']['candidates'][number],
    sourceDoc: Record<string, unknown>
): boolean {
    const expected = toPlainRecord(sourceDoc);
    const live = toPlainRecord(automergeRepository.getDoc(candidate.rootDocId));
    if (!expected || !live || !isRecord(expected.midi)) {
        return false;
    }
    const notesByClipId = expected.midi.notesByClipId;
    if (!isRecord(notesByClipId)) {
        return false;
    }
    notesByClipId[action.payload.snare.clipId] = candidate.snareNotes.map((note) => ({ ...note }));
    notesByClipId[action.payload.hiHat.clipId] = candidate.hiHatNotes.map((note) => ({ ...note }));
    return snapshotsEqual(live, expected);
}

export function isDrumPreviewBranchPlanApplied(action: CreateDrumPreviewBranchesAction): boolean {
    const { payload } = action;
    const state = branchStore.value;
    const sourceDoc = automergeRepository.getDoc<Record<string, unknown>>(DOC_PREFIX_ROOT);
    if (!state || !sourceDoc || !hasValidPlanShape(action)) {
        logger.warn('[CrdtDocument] EX-05 applied-plan check failed: source or plan is unavailable');
        return false;
    }
    if (
        state.activeBranchId !== payload.expectedSourceBranchId ||
        !hasExactDocumentSnapshot(
            action,
            payload.candidates.map(({ rootDocId }) => rootDocId)
        )
    ) {
        logger.warn('[CrdtDocument] EX-05 applied-plan check failed: source branch or documents changed');
        return false;
    }
    const candidateRecords: BranchRecord[] = payload.candidates.map((candidate) => ({
        branchId: candidate.branchId,
        name: candidate.branchName,
        rootDocId: candidate.rootDocId,
        sourceBranchId: payload.expectedSourceBranchId,
        createdAt: payload.createdAt,
        createdFromHeads: [...payload.expectedSourceHeads],
        note: `agent-preview:${payload.ownerId}`,
    }));
    const expectedState = {
        branches: [...payload.expectedBranchState.branches, ...candidateRecords],
        activeBranchId: payload.expectedSourceBranchId,
    };
    if (!snapshotsEqual(state, expectedState)) {
        logger.warn('[CrdtDocument] EX-05 applied-plan check failed: branch records changed');
        return false;
    }
    const exactCandidates = payload.candidates.every((candidate) =>
        hasExactCandidateDocument(action, candidate, sourceDoc)
    );
    if (!exactCandidates) {
        logger.warn('[CrdtDocument] EX-05 applied-plan check failed: candidate documents changed');
    }
    return exactCandidates;
}
