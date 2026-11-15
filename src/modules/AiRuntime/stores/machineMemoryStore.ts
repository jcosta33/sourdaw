import { createStore } from '#/infra/store/createStore';

import { type MachineMemoryReading } from '../models/MachineMemoryReading';

export const machineMemoryStore = createStore<MachineMemoryReading>({
    initialData: { state: 'unread' },
});
