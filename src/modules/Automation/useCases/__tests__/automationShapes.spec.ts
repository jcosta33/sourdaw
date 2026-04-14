import { describe, it, expect } from 'vitest';
import * as subject from '../automationShapes';

describe('automationShapes', () => {
    it('should export insertAutomationShape', () => {
        expect(subject.insertAutomationShape).toBeDefined();
        const t = typeof subject.insertAutomationShape;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
