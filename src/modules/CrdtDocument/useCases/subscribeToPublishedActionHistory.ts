import { getObjectId } from '@automerge/automerge';

import { sanitize_action_history_state, type ActionHistoryEntry } from '../models/ActionHistoryState';
import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

type SubscribeToPublishedActionHistoryInput = {
    onHistory(entries: readonly ActionHistoryEntry[]): void;
    onRootReplaced(): void;
};

/** Observe committed metadata, independently of the store's optimistic transaction view. */
export function subscribeToPublishedActionHistory({
    onHistory,
    onRootReplaced,
}: SubscribeToPublishedActionHistoryInput): () => void {
    let rootIdentity = automergeRepository.getRootIdentityEpoch();
    let publishedKey: string | undefined;

    const publish = (): void => {
        const document = automergeRepository.getDoc<{ actionHistory?: unknown }>(DOC_PREFIX_ROOT);
        const history = document?.actionHistory;
        const rawEntries: unknown =
            history !== null && typeof history === 'object' ? Reflect.get(history, 'entries') : undefined;
        const { entries } = sanitize_action_history_state(history);
        // A same-content clear replaces CRDT objects. Content alone would miss
        // its continuity break while a new local capability is still unflushed.
        const nextKey = JSON.stringify([getObjectId(history), getObjectId(rawEntries), entries]);
        if (nextKey === publishedKey) {
            return;
        }
        publishedKey = nextKey;
        onHistory(entries);
    };

    const unsubscribeChanges = automergeRepository.onChange((docId) => {
        if (docId === undefined || docId === DOC_PREFIX_ROOT) {
            publish();
        }
    });
    const unsubscribeRoot = automergeRepository.onRootInstallation(() => {
        const nextIdentity = automergeRepository.getRootIdentityEpoch();
        if (nextIdentity !== rootIdentity) {
            rootIdentity = nextIdentity;
            publishedKey = undefined;
            onRootReplaced();
        }
        publish();
    });
    const unsubscribe = (): void => {
        unsubscribeChanges();
        unsubscribeRoot();
    };
    try {
        publish();
    } catch (error) {
        unsubscribe();
        throw error;
    }
    return unsubscribe;
}
