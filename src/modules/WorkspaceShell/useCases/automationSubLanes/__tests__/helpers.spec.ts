import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export setAutomationSubLanes', () => {
        expect(subject.setAutomationSubLanes).toBeDefined();
        const time = typeof subject.setAutomationSubLanes;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
