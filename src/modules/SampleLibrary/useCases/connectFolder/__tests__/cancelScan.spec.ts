import { afterEach, describe, expect, it } from 'vitest';

import { cancelScan } from '../cancelScan';
import { getScanAbortController } from '../getScanAbortController';
import { setScanAbortController } from '../setScanAbortController';

describe('cancelScan', () => {
    afterEach(() => {
        // Reset module-level scan state so tests stay independent.
        setScanAbortController(null);
    });

    it('aborts the in-flight scan controller', () => {
        const controller = new AbortController();
        setScanAbortController(controller);
        expect(controller.signal.aborted).toBe(false);

        cancelScan();

        expect(controller.signal.aborted).toBe(true);
    });

    it('signals the same controller a running scan reads via getScanAbortController', () => {
        const controller = new AbortController();
        setScanAbortController(controller);

        // A scan loop checks getScanAbortController()?.signal.aborted each
        // iteration; cancelScan must flip exactly that signal.
        const signalSeenByScanner = getScanAbortController()!.signal;
        cancelScan();

        expect(signalSeenByScanner.aborted).toBe(true);
    });

    it('fires the abort event so listeners attached by a scan are notified', () => {
        const controller = new AbortController();
        setScanAbortController(controller);

        let notified = false;
        controller.signal.addEventListener('abort', () => {
            notified = true;
        });

        cancelScan();

        expect(notified).toBe(true);
    });

    it('is a no-op when no scan is active', () => {
        setScanAbortController(null);
        // Must not throw when there is nothing to cancel.
        expect(() => cancelScan()).not.toThrow();
        expect(getScanAbortController()).toBeNull();
    });

    it('does not abort a fresh controller installed after a prior scan was cancelled', () => {
        const first = new AbortController();
        setScanAbortController(first);
        cancelScan();
        expect(first.signal.aborted).toBe(true);

        // A subsequent scan installs its own controller; the stale abort from
        // the previous scan must not leak onto it.
        const second = new AbortController();
        setScanAbortController(second);
        expect(second.signal.aborted).toBe(false);
    });
});
