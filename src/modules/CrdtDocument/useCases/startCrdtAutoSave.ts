/**
 * startCrdtAutoSave — Debounced incremental CRDT persistence on every local mutation.
 *
 * Subscribes to automergeRepository.onChange() and writes an incremental
 * Automerge patch to IndexedDB at most once every DEBOUNCE_MS milliseconds
 * of inactivity.  This ensures edits survive a browser crash without requiring
 * the user to click "Save".
 *
 * Call once after a project is loaded or created.  Call the returned stop
 * function when the project is closed / replaced.
 */

import { automergeRepository } from '../repositories/automergeRepository';
import { persistCrdtProject } from './crdtProjectLifecycle';

const DEBOUNCE_MS = 2_000;

export function startCrdtAutoSave(): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            persistCrdtProject().catch((error) => {
                console.warn('[CrdtAutoSave] Incremental persist failed:', error);
            });
        }, DEBOUNCE_MS);
    };

    const unsubscribe = automergeRepository.onChange(schedule);

    return () => {
        unsubscribe();
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
