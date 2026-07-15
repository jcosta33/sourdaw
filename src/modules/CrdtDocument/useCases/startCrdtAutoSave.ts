/**
 * Debounced incremental CRDT persistence plus project-load durability recovery.
 * The returned stop function owns every subscription and timer in this lifecycle.
 */

import { logger } from '#/infra/logger/appLogger';

import { automergeRepository } from '../repositories/automergeRepository';

import { compactProject } from './compactProject';
import { persistCrdtProject } from './persistCrdtProject';

const DEBOUNCE_MS = 2_000;
const INITIAL_DURABILITY_RETRY_MS = 250;
const MAX_DURABILITY_RETRY_MS = 30_000;

const autoSaveHealth = { consecutiveFailures: 0 };

export function startCrdtAutoSave(): () => void {
    let incrementalTimer: ReturnType<typeof setTimeout> | null = null;
    let durabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let durabilityAttemptRunning = false;
    let durabilityRetryMs = INITIAL_DURABILITY_RETRY_MS;
    let stopped = false;

    function isStopped(): boolean {
        return stopped;
    }

    function scheduleDurabilityAttempt(delay: number): void {
        if (isStopped() || durabilityTimer !== null) {
            return;
        }
        durabilityTimer = setTimeout(() => {
            durabilityTimer = null;
            void establishProjectDurability();
        }, delay);
    }

    async function establishProjectDurability(): Promise<void> {
        if (isStopped() || durabilityAttemptRunning) {
            return;
        }
        durabilityAttemptRunning = true;
        let retryRequired = false;
        try {
            try {
                await compactProject();
                autoSaveHealth.consecutiveFailures = 0;
                durabilityRetryMs = INITIAL_DURABILITY_RETRY_MS;
                return;
            } catch (error) {
                logger.warn('[CrdtAutoSave] Full project persist failed; retrying immediately:', error);
                if (isStopped()) {
                    return;
                }
            }

            try {
                await compactProject();
                autoSaveHealth.consecutiveFailures = 0;
                durabilityRetryMs = INITIAL_DURABILITY_RETRY_MS;
                return;
            } catch (error) {
                retryRequired = true;
                logger.error(
                    new Error('[CrdtAutoSave] Immediate full project persist recovery failed', { cause: error })
                );
                if (isStopped()) {
                    return;
                }
            }

            try {
                await persistCrdtProject();
                autoSaveHealth.consecutiveFailures = 0;
            } catch (error) {
                autoSaveHealth.consecutiveFailures++;
                logger.error(
                    new Error('[CrdtAutoSave] Incremental recovery failed; full persistence remains scheduled', {
                        cause: error,
                    })
                );
            }
        } finally {
            durabilityAttemptRunning = false;
            if (retryRequired) {
                const delay = durabilityRetryMs;
                durabilityRetryMs = Math.min(durabilityRetryMs * 2, MAX_DURABILITY_RETRY_MS);
                scheduleDurabilityAttempt(delay);
            }
        }
    }

    function scheduleIncrementalPersist(): void {
        if (isStopped()) {
            return;
        }
        if (incrementalTimer !== null) {
            clearTimeout(incrementalTimer);
        }
        incrementalTimer = setTimeout(() => {
            incrementalTimer = null;
            persistCrdtProject()
                .then(() => {
                    autoSaveHealth.consecutiveFailures = 0;
                    return null;
                })
                .catch((error) => {
                    autoSaveHealth.consecutiveFailures++;
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (autoSaveHealth.consecutiveFailures <= 3) {
                        logger.warn('[CrdtAutoSave] Incremental persist failed:', error);
                    } else {
                        logger.error(
                            new Error(
                                `[CrdtAutoSave] Auto-save has failed ${autoSaveHealth.consecutiveFailures} times consecutively. ` +
                                    `Recent edits may not survive a browser restart. Check storage quota. Last error: ${errorMessage}`
                            )
                        );
                    }
                    return null;
                });
        }, DEBOUNCE_MS);
    }

    function doNothing(): void {}
    let unsubscribe = doNothing;
    try {
        unsubscribe = automergeRepository.onChange(scheduleIncrementalPersist);
    } catch (error) {
        logger.error(new Error('[CrdtAutoSave] Failed to subscribe to repository changes', { cause: error }));
    }
    scheduleDurabilityAttempt(0);

    return () => {
        stopped = true;
        try {
            unsubscribe();
        } finally {
            if (incrementalTimer !== null) {
                clearTimeout(incrementalTimer);
                incrementalTimer = null;
            }
            if (durabilityTimer !== null) {
                clearTimeout(durabilityTimer);
                durabilityTimer = null;
            }
        }
    };
}
