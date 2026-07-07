import { afterEach, describe, expect, it } from 'vitest';

import { getScanAbortController } from '../getScanAbortController';
import { setScanAbortController } from '../setScanAbortController';

describe('setScanAbortController', () => {
    afterEach(() => {
        setScanAbortController(null);
    });

    it('should replace the shared scan controller slot', () => {
        const controller = new AbortController();

        setScanAbortController(controller);

        expect(getScanAbortController()).toBe(controller);
    });

    it('should clear the shared scan controller slot', () => {
        setScanAbortController(new AbortController());

        setScanAbortController(null);

        expect(getScanAbortController()).toBeNull();
    });
});
