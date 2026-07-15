import { change, load, loadIncremental, save } from '@automerge/automerge';

import { type DocumentBundle } from '../models/CrdtDocumentTypes';
import { sanitize_action_history_state } from '../stores/actionHistoryStore';

import { compareIncrementalKeys } from './crdtPersistence/compareIncrementalKeys';

type PersistedDocument = {
    actionHistory?: unknown;
};

type SanitizePersistedActionHistoryBundleInput = {
    bundle: DocumentBundle;
};

type SanitizePersistedActionHistoryBundleOutput = {
    bundle: DocumentBundle;
    changed: boolean;
};

export function sanitizePersistedActionHistoryBundle({
    bundle,
}: SanitizePersistedActionHistoryBundleInput): SanitizePersistedActionHistoryBundleOutput {
    const sanitized_bundle = new Map(bundle);
    const document_ids = [...bundle.keys()].filter((key) => !key.includes(':incremental:'));
    let changed = false;

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

        let document_changed = incremental_keys.length > 0;
        if (document.actionHistory !== undefined) {
            const sanitized_history = sanitize_action_history_state(document.actionHistory);
            if (sanitized_history !== document.actionHistory) {
                document = change(document, (draft) => {
                    draft.actionHistory = sanitized_history;
                });
                document_changed = true;
            }
        }

        if (document_changed) {
            changed = true;
            sanitized_bundle.set(document_id, save(document));
            for (const key of incremental_keys) {
                sanitized_bundle.delete(key);
            }
        }
    }

    return { bundle: sanitized_bundle, changed };
}
