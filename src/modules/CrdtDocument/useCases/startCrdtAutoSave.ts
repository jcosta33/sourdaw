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

import { logger } from '#/infra/logger/appLogger';

import { automergeRepository } from '../repositories/automergeRepository';

import { persistCrdtProject } from './crdtProjectLifecycle';

const DEBOUNCE_MS = 2_000;

/** Consecutive save failure count — readable by UI to surface warnings. */
export const autoSaveHealth = { consecutiveFailures: 0 };

export function startCrdtAutoSave(): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(): void {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            persistCrdtProject()
                .then(() => {
                    autoSaveHealth.consecutiveFailures = 0;
                    return null;
                })
                .catch((error) => {
                    autoSaveHealth.consecutiveFailures++;
                    if (autoSaveHealth.consecutiveFailures <= 3) {
                        logger.warn('[CrdtAutoSave] Incremental persist failed:', error);
                    } else {
                        logger.error(
                            new Error(
                                `[CrdtAutoSave] Auto-save has failed ${autoSaveHealth.consecutiveFailures} times consecutively. ` +
                                    `Recent edits may not survive a browser restart. Check storage quota. Last error: ${error}`
                            )
                        );
                    }
                    return null;
                });
        }, DEBOUNCE_MS);
    }

    const unsubscribe = automergeRepository.onChange(schedule);

    return () => {
        unsubscribe();
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
