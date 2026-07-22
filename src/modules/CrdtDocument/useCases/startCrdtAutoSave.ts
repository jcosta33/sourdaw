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
/**
 * Upper bound on persistence lag while edits keep arriving. The plain
 * debounce re-arms on every change, so a continuous edit gesture (long
 * clip/automation drag) would defer persistence indefinitely — an unbounded
 * in-memory-only window against crash/close (audit F1). Once a burst has
 * been debouncing for this long, the persist fires at the cap instead of
 * now+DEBOUNCE.
 */
const MAX_WAIT_MS = 10_000;

const autoSaveHealth = { consecutiveFailures: 0 };

export function startCrdtAutoSave(): () => void {
    let incrementalTimer: ReturnType<typeof setTimeout> | null = null;
    let durabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let durabilityAttemptRunning = false;
    let durabilityRetryMs = INITIAL_DURABILITY_RETRY_MS;
    let burstStartMs: number | null = null;
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

    function runIncrementalPersist(): void {
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
    }

    function scheduleIncrementalPersist(): void {
        if (isStopped()) {
            return;
        }
        const now = Date.now();
        if (burstStartMs === null) {
            burstStartMs = now;
        }
        if (incrementalTimer !== null) {
            clearTimeout(incrementalTimer);
        }
        // Standard debounce (2 s after the last edit), capped so a
        // continuously re-armed burst can never starve persistence beyond
        // MAX_WAIT_MS from its first edit.
        const delay = Math.min(DEBOUNCE_MS, burstStartMs + MAX_WAIT_MS - now);
        incrementalTimer = setTimeout(
            () => {
                incrementalTimer = null;
                burstStartMs = null;
                runIncrementalPersist();
            },
            Math.max(0, delay)
        );
    }

    /**
     * Best-effort flush of a pending debounced persist on tab hide/close.
     * `pagehide` is the reliable unload signal (beforeunload is not);
     * `visibilitychange → hidden` additionally covers backgrounding, where
     * timers are throttled. Caveat (audit F1): the incremental save is
     * async IndexedDB work — the browser may kill the page before it
     * commits, so this bounds the loss window but cannot guarantee zero
     * loss on hard crash. Nothing stronger is available synchronously.
     */
    function flushPendingPersist(): void {
        if (isStopped() || incrementalTimer === null) {
            return;
        }
        clearTimeout(incrementalTimer);
        incrementalTimer = null;
        burstStartMs = null;
        runIncrementalPersist();
    }

    function onPageHide(): void {
        flushPendingPersist();
    }

    function onVisibilityChange(): void {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            flushPendingPersist();
        }
    }

    function doNothing(): void {}
    let unsubscribe = doNothing;
    try {
        unsubscribe = automergeRepository.onChange(scheduleIncrementalPersist);
    } catch (error) {
        logger.error(new Error('[CrdtAutoSave] Failed to subscribe to repository changes', { cause: error }));
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', onPageHide);
    }
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
    }
    scheduleDurabilityAttempt(0);

    return () => {
        stopped = true;
        try {
            unsubscribe();
        } finally {
            if (typeof window !== 'undefined') {
                window.removeEventListener('pagehide', onPageHide);
            }
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
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
