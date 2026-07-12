import { change, load, loadIncremental, save } from '@automerge/automerge';

import { type DocumentBundle } from '../models/CrdtDocumentTypes';

import { compareIncrementalKeys } from './crdtPersistence/compareIncrementalKeys';

type PersistedDocument = {
    actionHistory?: unknown;
};

type SanitizePersistedActionHistoryBundleInput = {
    bundle: DocumentBundle;
};

export function sanitizePersistedActionHistoryBundle({
    bundle,
}: SanitizePersistedActionHistoryBundleInput): DocumentBundle {
    const sanitized_bundle = new Map(bundle);
    const document_ids = [...bundle.keys()].filter((key) => !key.includes(':incremental:'));

    for (const document_id of document_ids) {
        const document_bytes = bundle.get(document_id);
        if (!document_bytes) {
            continue;
        }

        let document = load<PersistedDocument>(document_bytes);
        const incremental_keys = [...bundle.keys()]
            .filter((key) => key.startsWith(`${document_id}:incremental:`))
            .sort(compareIncrementalKeys);

        for (const key of incremental_keys) {
            const incremental_bytes = bundle.get(key);
            if (incremental_bytes) {
                document = loadIncremental(document, incremental_bytes);
            }
        }

        if (document.actionHistory !== undefined) {
            document = change(document, (draft) => {
                delete draft.actionHistory;
            });
        }

        sanitized_bundle.set(document_id, save(document));
        for (const key of incremental_keys) {
            sanitized_bundle.delete(key);
        }
    }

    return sanitized_bundle;
}
