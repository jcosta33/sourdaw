import { afterEach, describe, expect, it } from 'vitest';

import { cancelScan } from '../cancelScan';
import { getScanAbortController } from '../getScanAbortController';
import { setScanAbortController } from '../setScanAbortController';

describe('getScanAbortController', () => {
    afterEach(() => {
        setScanAbortController(null);
    });

    it('should return null before any scan installs a controller', () => {
        setScanAbortController(null);
        expect(getScanAbortController()).toBeNull();
    });

    it('should return the same controller installed through setScanAbortController', () => {
        const controller = new AbortController();
        setScanAbortController(controller);

        expect(getScanAbortController()).toBe(controller);
    });

    it('should expose the latest controller when overlapping scans overwrite the shared slot', () => {
        const firstScan = new AbortController();
        setScanAbortController(firstScan);

        const secondScan = new AbortController();
        setScanAbortController(secondScan);

        expect(getScanAbortController()).toBe(secondScan);
        expect(getScanAbortController()).not.toBe(firstScan);
    });

    it('should let cancelScan abort only the latest controller in the shared slot', () => {
        const firstScan = new AbortController();
        setScanAbortController(firstScan);

        const secondScan = new AbortController();
        setScanAbortController(secondScan);

        cancelScan();

        expect(secondScan.signal.aborted).toBe(true);
        expect(firstScan.signal.aborted).toBe(false);
    });
});
