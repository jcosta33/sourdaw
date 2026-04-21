import { describe, it, expect } from 'vitest';

import * as subject from '../GrooveModule';

describe('GrooveModule', () => {
    it('should export GrooveModule', () => {
        expect(subject.GrooveModule).toBeDefined();
        const time = typeof subject.GrooveModule;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
