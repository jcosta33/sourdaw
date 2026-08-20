/**
 * Global pool for GainNodes to prevent main-thread GC allocations
 * during high-frequency audio scheduling ticks.
 */
export const gainNodePool: GainNode[] = [];
