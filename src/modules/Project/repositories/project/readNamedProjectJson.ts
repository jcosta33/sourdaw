import { pickNewerProjectSnapshot } from './pickNewerProjectSnapshot';
import { readNamedProjectJsonFromIndexedDb } from './readNamedProjectJsonFromIndexedDb';
import { readNamedProjectJsonFromLocalStorage } from './readNamedProjectJsonFromLocalStorage';

/**
 * Read a named project, resolving by recency rather than by which store happens
 * to hold a copy.
 *
 * The retired behaviour returned the localStorage copy whenever it was
 * *present*. Its author anticipated quota and built the fallback for the copy
 * being *absent*; the real failure mode was *staleness*. A project that was
 * small when first saved got a mirror, and once it grew past the 5 MiB
 * localStorage quota the mirror froze while IndexedDB kept receiving every
 * later save — and this read handed the frozen copy back, which then reseeded
 * CRDT authority over the good state (ADR 0013).
 *
 * IndexedDB is now the only store project content is written to. A localStorage
 * mirror can only be a pre-migration leftover, so it wins only when it can
 * prove it is newer — see {@link pickNewerProjectSnapshot}.
 */
export async function readNamedProjectJson(key: string): Promise<string | null> {
    const mirror = readNamedProjectJsonFromLocalStorage(key);
    const primary = await readNamedProjectJsonFromIndexedDb(key);

    if (primary === null) {
        return mirror;
    }
    if (mirror === null) {
        return primary;
    }
    if (pickNewerProjectSnapshot({ primary, mirror }) === 'mirror') {
        return mirror;
    }
    return primary;
}
