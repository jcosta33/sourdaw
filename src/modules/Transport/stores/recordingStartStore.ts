import { createStore } from '#/infra/store/createStore';

/**
 * Runtime-only: true while a recording start is waiting (count-in, pre-roll, hardware
 * admission) or a stop is still closing a take. `recordingLifecycle` is the only writer;
 * it holds the state this mirrors. Not part of `TransportState`, never persisted.
 */
export const recordingStartStore = createStore<boolean>({ initialData: false });
