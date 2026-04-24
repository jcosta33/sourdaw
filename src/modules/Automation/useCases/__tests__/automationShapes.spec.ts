import { describe, it, expect } from 'vitest';

import * as subject from '../automationShapes';

describe('automationShapes', () => {
    it('should export insertAutomationShape', () => {
        expect(subject.insertAutomationShape).toBeDefined();
        const time = typeof subject.insertAutomationShape;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
