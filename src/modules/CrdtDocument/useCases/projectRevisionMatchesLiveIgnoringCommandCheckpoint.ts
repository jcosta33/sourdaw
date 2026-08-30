import { type Heads } from '@automerge/automerge';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

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

function projectDocumentWithoutCommandCheckpoint(document: Record<string, unknown>): Record<string, unknown> {
    const { commandBatchIdempotency: _commandCheckpoint, ...projectDocument } = document;
    return projectDocument;
}

function readPlainDocument(document: Record<string, unknown>): Record<string, unknown> | null {
    const parsed: unknown = JSON.parse(JSON.stringify(document));
    return isRecord(parsed) ? parsed : null;
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

function rootDocumentMatchesHeads(expectedHeads: readonly string[]): boolean {
    const liveDoc = automergeRepository.getDoc<Record<string, unknown>>(DOC_PREFIX_ROOT);
    const expectedDoc = automergeRepository.getDocAtHeads<Record<string, unknown>>(
        DOC_PREFIX_ROOT,
        expectedHeads as Heads
    );
    const livePlain = liveDoc ? readPlainDocument(liveDoc) : null;
    const expectedPlain = expectedDoc ? readPlainDocument(expectedDoc) : null;
    if (!livePlain || !expectedPlain) {
        return false;
    }
    return snapshotsEqual(
        projectDocumentWithoutCommandCheckpoint(livePlain),
        projectDocumentWithoutCommandCheckpoint(expectedPlain)
    );
}

/**
 * True when live project truth still matches `expectedRevision` except for the
 * command-batch checkpoint slot journaled onto root after the musician-visible
 * commit. Mutation epoch and root heads may advance for that slot; any other
 * document identity or content change is a real project change.
 */
export function projectRevisionMatchesLiveIgnoringCommandCheckpoint(expectedRevision: string): boolean {
    const liveRevision = captureProjectRevision();
    if (liveRevision === expectedRevision) {
        return true;
    }
    const expected = parseCapturedProjectRevision(expectedRevision);
    const live = parseCapturedProjectRevision(liveRevision);
    if (!expected || !live || expected.documentIdentityEpoch !== live.documentIdentityEpoch) {
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
            if (!rootDocumentMatchesHeads(document.heads)) {
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
