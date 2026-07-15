import { change, load, save, type Doc } from '@automerge/automerge';

import { sanitize_action_history_state } from '../models/ActionHistoryState';

type IncomingDocument = {
    actionHistory?: unknown;
};

export function sanitizeIncomingCrdtDocument(document: Doc<unknown>): Doc<unknown> {
    const action_history: unknown = Reflect.get(document, 'actionHistory');
    if (action_history === undefined) {
        return document;
    }

    const sanitized_history = sanitize_action_history_state(action_history);
    if (sanitized_history === action_history) {
        return document;
    }

    let sanitized_document = load<IncomingDocument>(save(document));
    sanitized_document = change(sanitized_document, (draft) => {
        draft.actionHistory = sanitized_history;
    });
    return sanitized_document;
}
