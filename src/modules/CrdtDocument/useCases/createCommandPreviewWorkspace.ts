import { type Doc } from '@automerge/automerge';

import {
    createAutomergeStoragePreview,
    hasForeignPendingAutomergeStorageWrites,
    runOutsideAutomergeStoragePublisherScope,
} from '#/infra/store/storage/createAutomergeStorage';

import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

import { settledProjectRevisionMatchesLiveIgnoringSaveWrites } from './settledProjectRevisionMatchesLiveIgnoringSaveWrites';

export function createCommandPreviewWorkspace(expectedRevision: string) {
    if (!settledProjectRevisionMatchesLiveIgnoringSaveWrites(expectedRevision)) {
        throw new Error('Command batch base revision does not match current project state');
    }

    // A private workspace cannot inherit the live caller's pending-write exemption.
    const hasPendingProjectWrites = runOutsideAutomergeStoragePublisherScope(() =>
        automergeRepository.getDocIds().some(hasForeignPendingAutomergeStorageWrites)
    );
    if (hasPendingProjectWrites) {
        throw new Error('Command preview has pending project writes');
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
