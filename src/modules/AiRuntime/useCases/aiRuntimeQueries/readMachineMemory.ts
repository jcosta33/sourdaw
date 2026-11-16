import { logger } from '#/infra/logger/appLogger';

import { readMachineMemoryFigures } from '../../repositories/machineMemory/readMachineMemoryFigures';
import { machineMemoryStore } from '../../stores/machineMemoryStore';

let inFlight: Promise<void> | null = null;

async function readOnce(): Promise<void> {
    try {
        const figures = await readMachineMemoryFigures();
        machineMemoryStore.set(figures === null ? { state: 'unavailable' } : { state: 'known', ...figures });
    } catch (error) {
        logger.warn("The desktop shell could not report this machine's memory; the local model list is not narrowed", {
            error,
        });
        machineMemoryStore.set({ state: 'unavailable' });
    }
}

/**
 * Reads the machine's total memory and GPU memory budget once into `machineMemoryStore`. The figure does not change while the
 * app runs, so a settled reading is never re-read and concurrent callers share one bridge call.
 */
export function readMachineMemory(): Promise<void> {
    if (machineMemoryStore.value?.state !== 'unread') {
        return Promise.resolve();
    }
    inFlight ??= readOnce().finally(() => {
        inFlight = null;
    });
    return inFlight;
}
