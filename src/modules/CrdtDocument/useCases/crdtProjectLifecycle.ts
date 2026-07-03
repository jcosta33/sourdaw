/**
 * Detect which persistence backend to use.
 */
export function getPersistenceBackend(): 'native' | 'browser' {
    // The project lifecycle above still reads and writes IndexedDB; native CRDT
    // wrappers stay parked until those lifecycle paths are wired to them.
    return 'browser';
}
