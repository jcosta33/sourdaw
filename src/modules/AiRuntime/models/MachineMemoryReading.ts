/**
 * What is known of this machine's memory. A process constant once read. `gpuBudgetBytes` is the memory a
 * model's weights can occupy on the GPU, which is not the system total: a discrete GPU holds far less
 * than the RAM, and Metal caps a process's working set below unified memory. Null where it is unknown.
 */
export type MachineMemoryReading =
    | { state: 'unread' }
    | { state: 'known'; totalBytes: number; gpuBudgetBytes: number | null }
    | { state: 'unavailable' };
