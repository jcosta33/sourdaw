import { describe, expect, it } from 'vitest';

import { readNativeEngineIncarnation } from '../nativeEngineIncarnation';

const NAMESPACE = 'dc0f62d1-dc26-4c5c-81db-36130c1466e4';

describe('native engine incarnation', () => {
    it('preserves epoch zero and epochs beyond JS integer precision exactly', () => {
        for (const epoch of ['0', '9007199254740993', '18446744073709551614']) {
            const identity = `${NAMESPACE}:${epoch}`;
            expect(readNativeEngineIncarnation(identity)).toBe(identity);
        }
    });

    it('withholds missing, malformed, noncanonical and saturated identities', () => {
        for (const value of [
            undefined,
            null,
            0,
            '',
            `${NAMESPACE}:01`,
            `${NAMESPACE}:-1`,
            `${NAMESPACE}:1.5`,
            `${NAMESPACE}:18446744073709551615`,
            `${NAMESPACE}:18446744073709551616`,
            `${NAMESPACE.toUpperCase()}:1`,
            `${NAMESPACE}:1 `,
        ]) {
            expect(readNativeEngineIncarnation(value)).toBeUndefined();
        }
    });
});
