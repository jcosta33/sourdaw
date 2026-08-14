import { type Doc } from '@automerge/automerge';

import { createAutomergeStoragePreview } from '#/infra/store/storage/createAutomergeStorage';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

import { captureProjectRevision } from './captureProjectRevision';
import { parseProjectRevision } from './parseProjectRevision';

export function createCommandRecoveryWorkspace(baseRevision: string) {
    const base = parseProjectRevision(baseRevision);
    const current = parseProjectRevision(captureProjectRevision());
    if (!base || !current || base.documentIdentityEpoch !== current.documentIdentityEpoch) {
        throw new Error('Command recovery base revision is unavailable');
    }

    const documents = new Map<string, Doc<Record<string, unknown>>>();
    for (const { docId, heads } of base.documents) {
        const document = automergeRepository.getDocAtHeads<Record<string, unknown>>(docId, heads);
        if (!document) {
            throw new Error(`Command recovery document is unavailable: ${docId}`);
        }
        documents.set(docId, document);
    }
    if (!documents.has(DOC_PREFIX_ROOT)) {
        throw new Error('Command recovery root document is unavailable');
    }

    const preview = createAutomergeStoragePreview(documents);
    return {
        getProjectDocument(): Readonly<Record<string, unknown>> {
            const document = preview.getDocument(DOC_PREFIX_ROOT);
            if (!document) {
                throw new Error('Command recovery workspace has been released');
            }
            return document;
        },
        release: preview.release,
        scope: preview.scope,
    };
}
