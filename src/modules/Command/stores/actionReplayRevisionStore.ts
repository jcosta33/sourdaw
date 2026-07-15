import { createStore } from '#/infra/store/createStore';
import { type ReadableStore } from '#/infra/store/types';

const action_replay_revision_store = createStore<number>({ initialData: 0 });

export const actionReplayRevisionStore: ReadableStore<number> = {
    get value() {
        return action_replay_revision_store.value;
    },
    subscribe: (callback) => action_replay_revision_store.subscribe(callback),
    subscribeReact: (listener) => action_replay_revision_store.subscribeReact(listener),
    getSnapshot: () => action_replay_revision_store.getSnapshot(),
};

export function bumpActionReplayRevision(): void {
    action_replay_revision_store.set((action_replay_revision_store.value ?? 0) + 1);
}
