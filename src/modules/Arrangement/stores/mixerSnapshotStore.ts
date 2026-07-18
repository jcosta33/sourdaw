import { createStore } from '#/infra/store/createStore';

import { type MixerSnapshot } from '../models/MixerSnapshotTypes';

export type MixerSnapshotState = {
    snapshots: MixerSnapshot[];
};

export const mixerSnapshotStore = createStore<MixerSnapshotState>({
    initialData: { snapshots: [] },
});
