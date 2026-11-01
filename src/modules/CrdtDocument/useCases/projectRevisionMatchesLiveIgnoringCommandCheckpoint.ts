import { type Heads } from '@automerge/automerge';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { readChangesSinceHeads } from '../repositories/readChangesSinceHeads';

import { captureProjectRevision } from './captureProjectRevision';

type CapturedDocumentRevision = {
    docId: string;
    heads: string[];
};

type CapturedProjectRevision = {
    documentIdentityEpoch: number;
    mutationEpoch: number;
    documents: CapturedDocumentRevision[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCapturedProjectRevision(serialized: string): CapturedProjectRevision | null {
    try {
        const parsed: unknown = JSON.parse(serialized);
        if (!isRecord(parsed) || !Array.isArray(parsed.documents)) {
            return null;
        }
        if (
            typeof parsed.documentIdentityEpoch !== 'number' ||
            !Number.isInteger(parsed.documentIdentityEpoch) ||
            typeof parsed.mutationEpoch !== 'number' ||
            !Number.isInteger(parsed.mutationEpoch)
        ) {
            return null;
        }
        const documents: CapturedDocumentRevision[] = [];
        for (const candidate of parsed.documents) {
            if (!isRecord(candidate) || typeof candidate.docId !== 'string' || !Array.isArray(candidate.heads)) {
                return null;
            }
            const heads: string[] = [];
            for (const head of candidate.heads) {
                if (typeof head !== 'string') {
                    return null;
                }
                heads.push(head);
            }
            documents.push({ docId: candidate.docId, heads });
        }
        return {
            documentIdentityEpoch: parsed.documentIdentityEpoch,
            mutationEpoch: parsed.mutationEpoch,
            documents,
        };
    } catch {
        return null;
    }
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

/** The part of the root document a comparison counts as project truth. */
type RootProjection = (document: Record<string, unknown>) => Record<string, unknown>;

function projectDocumentWithoutCommandCheckpoint(document: Record<string, unknown>): Record<string, unknown> {
    const { commandBatchIdempotency: _commandCheckpoint, ...projectDocument } = document;
    return projectDocument;
}

function withoutSaveTimestamp(projectMeta: unknown): unknown {
    if (!isRecord(projectMeta)) {
        return projectMeta;
    }
    const { updatedAt: _saveTimestamp, ...meta } = projectMeta;
    return meta;
}

/**
 * The active arrangement's entry copies the live slots (`tracks`, `automation`, `midi`, the tempo
 * and time-signature maps, `markers`, take lanes), which the comparison still reads on their own;
 * only its id and name are its own.
 */
function withoutActiveArrangementSnapshot(arrangements: unknown): unknown {
    if (!isRecord(arrangements) || !Array.isArray(arrangements.arrangements)) {
        return arrangements;
    }
    const activeId = arrangements.activeArrangementId;
    return {
        ...arrangements,
        arrangements: arrangements.arrangements.map((entry: unknown) =>
            isRecord(entry) && entry.id === activeId ? { id: entry.id, name: entry.name } : entry
        ),
    };
}

/**
 * What a save writes into root besides content: it stamps `projectMeta.updatedAt` before it
 * serializes, and refreshes the active arrangement's entry from the live slots
 * (`syncCurrentArrangementToStore`). Every other root field, those live slots included, still counts.
 */
function projectDocumentWithoutCommandCheckpointOrSaveWrites(
    document: Record<string, unknown>
): Record<string, unknown> {
    const projectDocument = projectDocumentWithoutCommandCheckpoint(document);
    return {
        ...projectDocument,
        projectMeta: withoutSaveTimestamp(projectDocument.projectMeta),
        arrangements: withoutActiveArrangementSnapshot(projectDocument.arrangements),
    };
}

function readProjectedDocument(
    document: Record<string, unknown> | undefined,
    project: RootProjection
): Record<string, unknown> | null {
    if (!document) {
        return null;
    }
    const parsed: unknown = JSON.parse(JSON.stringify(document));
    return isRecord(parsed) ? project(parsed) : null;
}

function snapshotsEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(normalizeJsonValue(left)) === JSON.stringify(normalizeJsonValue(right));
}

function headsEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const sortedRight = [...right].toSorted();
    return [...left].toSorted().every((head, index) => head === sortedRight[index]);
}

function readProjectedRootAtHeads(heads: Heads, project: RootProjection): Record<string, unknown> | null {
    return readProjectedDocument(
        automergeRepository.getDocAtHeads<Record<string, unknown>>(DOC_PREFIX_ROOT, heads),
        project
    );
}

/**
 * True when every root change after `expectedHeads` left the project truth
 * `project` keeps untouched.
 *
 * Comparing the live document against the expected view is not enough on its
 * own: an edit that is reverted afterwards — tempo 120 -> 128 -> 120, or a
 * field added and deleted again — leaves those two snapshots equal on heads
 * that moved for a musician-visible reason. Compare each change against its
 * own dependency frontier so reverted and conflict-losing edits are still seen.
 * A branch need not contain every captured sibling head: comparing its isolated
 * state with the merged capture would mistake missing sibling truth for an edit.
 */
function rootAdvancedOnlyOutsideProjection(expectedHeads: Heads, project: RootProjection): boolean {
    const expectedProjection = readProjectedRootAtHeads(expectedHeads, project);
    const liveProjection = readProjectedDocument(
        automergeRepository.getDoc<Record<string, unknown>>(DOC_PREFIX_ROOT),
        project
    );
    if (!expectedProjection || !liveProjection || !snapshotsEqual(liveProjection, expectedProjection)) {
        return false;
    }
    const changes = readChangesSinceHeads(DOC_PREFIX_ROOT, expectedHeads);
    if (!changes) {
        return false;
    }
    return changes.every(({ hash, deps }) => {
        const before = readProjectedRootAtHeads(deps, project);
        const after = readProjectedRootAtHeads([hash], project);
        return before !== null && after !== null && snapshotsEqual(before, after);
    });
}

function projectRevisionMatchesLiveWithinRootProjection(expectedRevision: string, project: RootProjection): boolean {
    const expected = parseCapturedProjectRevision(expectedRevision);
    if (!expected || automergeRepository.getLastHistoryDiscardEpoch() > expected.mutationEpoch) {
        return false;
    }
    const liveRevision = captureProjectRevision();
    if (liveRevision === expectedRevision) {
        return true;
    }
    const live = parseCapturedProjectRevision(liveRevision);
    if (!live || expected.documentIdentityEpoch !== live.documentIdentityEpoch) {
        return false;
    }
    if (expected.documents.length !== live.documents.length) {
        return false;
    }
    const liveById = new Map(live.documents.map((document) => [document.docId, document]));
    for (const document of expected.documents) {
        const liveDocument = liveById.get(document.docId);
        if (!liveDocument) {
            return false;
        }
        if (document.docId === DOC_PREFIX_ROOT) {
            if (headsEqual(document.heads, liveDocument.heads)) {
                continue;
            }
            if (!rootAdvancedOnlyOutsideProjection(document.heads, project)) {
                return false;
            }
            continue;
        }
        if (!headsEqual(document.heads, liveDocument.heads)) {
            return false;
        }
    }
    return true;
}

/**
 * True when live project truth still matches `expectedRevision` except for the
 * command-batch checkpoint slot journaled onto root after the musician-visible
 * commit. Mutation epoch and root heads may advance for that slot; any other
 * document identity or content change is a real project change.
 */
export function projectRevisionMatchesLiveIgnoringCommandCheckpoint(expectedRevision: string): boolean {
    return projectRevisionMatchesLiveWithinRootProjection(expectedRevision, projectDocumentWithoutCommandCheckpoint);
}

/**
 * As `projectRevisionMatchesLiveIgnoringCommandCheckpoint`, and also tolerating what a save writes
 * into root: the save timestamp (`projectMeta.updatedAt`) and the active arrangement's copy of the
 * live slots. A save between capture and check is then no project change, while every other
 * `projectMeta` field (name, key, scale, tuning, brief, identity), the live slots themselves and the
 * active arrangement's id and name still count. For a reader that only asks "is this still the same
 * project content"; command admission keeps the stricter check.
 */
export function projectRevisionMatchesLiveIgnoringSaveWrites(expectedRevision: string): boolean {
    return projectRevisionMatchesLiveWithinRootProjection(
        expectedRevision,
        projectDocumentWithoutCommandCheckpointOrSaveWrites
    );
}
