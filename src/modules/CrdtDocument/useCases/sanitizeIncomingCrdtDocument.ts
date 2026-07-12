import { change, load, save, type Doc } from '@automerge/automerge';

import { normalize_action_history_state } from '../stores/actionHistoryStore';

type IncomingDocument = {
    actionHistory?: unknown;
};

export function sanitizeIncomingCrdtDocument(document: Doc<unknown>): Doc<unknown> {
    let sanitized_document = load<IncomingDocument>(save(document));
    if (sanitized_document.actionHistory === undefined) {
        return sanitized_document;
    }

    const sanitized_history = normalize_action_history_state(sanitized_document.actionHistory);
    sanitized_document = change(sanitized_document, (draft) => {
        draft.actionHistory = sanitized_history;
    });
    return sanitized_document;
}
