import { describe, it, expect } from 'vitest';
import * as subject from '../toggleCollaborationPanel';

describe('toggleCollaborationPanel', () => {
    it('should export toggleCollaborationPanel', () => {
        expect(subject.toggleCollaborationPanel).toBeDefined();
        const t = typeof subject.toggleCollaborationPanel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
