import { change, load, loadIncremental, save } from '@automerge/automerge';

import { DOC_PREFIX_ROOT, type DocumentBundle } from '../models/CrdtDocumentTypes';

import { compareIncrementalKeys } from './crdtPersistence/compareIncrementalKeys';

type PersistedRootDocument = {
    actionHistory?: unknown;
};

type SanitizePersistedActionHistoryBundleInput = {
    bundle: DocumentBundle;
};

export function sanitizePersistedActionHistoryBundle({
    bundle,
}: SanitizePersistedActionHistoryBundleInput): DocumentBundle {
    const root_bytes = bundle.get(DOC_PREFIX_ROOT);
    if (!root_bytes) {
        return bundle;
    }

    let root_document = load<PersistedRootDocument>(root_bytes);
    const root_incremental_keys = [...bundle.keys()]
        .filter((key) => key.startsWith(`${DOC_PREFIX_ROOT}:incremental:`))
        .sort(compareIncrementalKeys);

    for (const key of root_incremental_keys) {
        const incremental_bytes = bundle.get(key);
        if (incremental_bytes) {
            root_document = loadIncremental(root_document, incremental_bytes);
        }
    }

    if (root_document.actionHistory === undefined) {
        return bundle;
    }

    const sanitized_root = change(root_document, (document) => {
        delete document.actionHistory;
    });
    const sanitized_bundle = new Map(bundle);
    sanitized_bundle.set(DOC_PREFIX_ROOT, save(sanitized_root));
    for (const key of root_incremental_keys) {
        sanitized_bundle.delete(key);
    }
    return sanitized_bundle;
}
