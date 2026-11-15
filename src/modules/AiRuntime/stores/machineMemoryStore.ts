import { createStore } from '#/infra/store/createStore';

import { type MachineMemoryReading as Reading } from '../models/MachineMemoryReading';

export type MachineMemoryReading = Reading;

export const machineMemoryStore = createStore<MachineMemoryReading>({
    initialData: { state: 'unread' },
});
