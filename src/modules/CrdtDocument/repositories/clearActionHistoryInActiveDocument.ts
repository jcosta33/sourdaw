import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';

import { automergeRepository } from './automergeRepository';

type ActionHistoryDocument = {
    actionHistory?: unknown;
};

export function clearActionHistoryInActiveDocument(): void {
    automergeRepository.changeDoc<ActionHistoryDocument>(DOC_PREFIX_ROOT, (document) => {
        document.actionHistory = { entries: [] };
    });
}
