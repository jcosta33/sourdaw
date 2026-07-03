import { type ReadableStore } from '#/infra/store/types';

import { undoStore as mutable_undo_store, type UndoStoreState } from './undoStore';

export const undoStore: ReadableStore<UndoStoreState> = {
    get value() {
        return mutable_undo_store.value;
    },

    subscribe(callback) {
        return mutable_undo_store.subscribe(callback);
    },

    subscribeReact(listener) {
        return mutable_undo_store.subscribeReact(listener);
    },

    getSnapshot() {
        return mutable_undo_store.getSnapshot();
    },
};
