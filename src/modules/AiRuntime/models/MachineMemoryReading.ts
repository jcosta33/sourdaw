/** What is known of this machine's total physical memory. A process constant once read. */
export type MachineMemoryReading =
    { state: 'unread' } | { state: 'known'; totalBytes: number } | { state: 'unavailable' };
