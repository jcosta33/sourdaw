import { afterEach, describe, expect, it } from 'vitest';

import { cancelScan } from '../cancelScan';
import { getScanAbortController, setScanAbortController } from '../helpers';

describe('scan abort controller state', () => {
    afterEach(() => {
        setScanAbortController(null);
    });

    it('returns null before any scan installs a controller', () => {
        setScanAbortController(null);
        expect(getScanAbortController()).toBeNull();
    });

    it('round-trips the controller set by a scan', () => {
        const controller = new AbortController();
        setScanAbortController(controller);
        expect(getScanAbortController()).toBe(controller);
    });

    it('clears the controller when a scan finishes (set to null)', () => {
        setScanAbortController(new AbortController());
        setScanAbortController(null);
        expect(getScanAbortController()).toBeNull();
    });

    describe('concurrent scans share a single controller slot (the cancel race)', () => {
        it('a second scan overwrites the first scan’s controller', () => {
            // scanBrowserDirectory / scanTauriDirectory each begin with
            // setScanAbortController(new AbortController()). If a second scan
            // starts while the first is still running, the first scan loses its
            // handle on its own controller — only the latest survives in the slot.
            const firstScan = new AbortController();
            setScanAbortController(firstScan);

            const secondScan = new AbortController();
            setScanAbortController(secondScan);

            expect(getScanAbortController()).toBe(secondScan);
            // The first scan's controller is now orphaned: cancelScan can no
            // longer reach it through the module slot.
            expect(getScanAbortController()).not.toBe(firstScan);
        });

        it('cancelScan after overlap aborts only the latest scan, leaving the first uncancellable via the slot', () => {
            const firstScan = new AbortController();
            setScanAbortController(firstScan);

            const secondScan = new AbortController();
            setScanAbortController(secondScan);

            cancelScan();

            // Only the controller currently in the slot is aborted.
            expect(secondScan.signal.aborted).toBe(true);
            // The first scan's controller was already orphaned by the overwrite,
            // so cancelScan cannot abort it — documenting the shared-slot race.
            expect(firstScan.signal.aborted).toBe(false);
        });
    });
});
