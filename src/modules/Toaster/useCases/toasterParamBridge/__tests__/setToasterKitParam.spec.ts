import { describe, it, expect } from 'vitest';

import * as subject from '../setToasterKitParam';

describe('setToasterKitParam', () => {
    it('should export setToasterKitParam', () => {
        expect(subject.setToasterKitParam).toBeDefined();
        const time = typeof subject.setToasterKitParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
