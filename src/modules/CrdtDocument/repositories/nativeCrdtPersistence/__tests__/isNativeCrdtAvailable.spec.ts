import { describe, expect, it } from 'vitest';

import { isTauriAvailable } from '../helpers';
import { isNativeCrdtAvailable } from '../isNativeCrdtAvailable';

describe('isNativeCrdtAvailable', () => {
    it('delegates to isTauriAvailable', () => {
        expect(isNativeCrdtAvailable()).toBe(isTauriAvailable());
    });
});
