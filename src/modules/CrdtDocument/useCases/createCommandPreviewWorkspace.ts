import { type Doc } from '@automerge/automerge';

import { createAutomergeStoragePreview } from '#/infra/store/storage/createAutomergeStorage';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

import { captureProjectRevision } from './captureProjectRevision';

export function createCommandPreviewWorkspace(expectedRevision: string) {
    if (captureProjectRevision() !== expectedRevision) {
        throw new Error('Command batch base revision does not match current project state');
    }

    const documents = new Map<string, Doc<Record<string, unknown>>>();
    for (const docId of automergeRepository.getDocIds()) {
        const document = automergeRepository.getDoc<Record<string, unknown>>(docId);
        if (document) {
            documents.set(docId, document);
        }
    }
    if (!documents.has(DOC_PREFIX_ROOT)) {
        throw new Error('Command preview root document is unavailable');
    }

    const preview = createAutomergeStoragePreview(documents);
    return {
        getProjectDocument(): Readonly<Record<string, unknown>> {
            const document = preview.getDocument(DOC_PREFIX_ROOT);
            if (!document) {
                throw new Error('Command preview has been released');
            }
            return document;
        },
        release: preview.release,
        scope: preview.scope,
    };
}
