import { describe, it, expect } from 'vitest';

import * as subject from '../toggleCollaborationPanel';

describe('toggleCollaborationPanel', () => {
    it('should export toggleCollaborationPanel', () => {
        expect(subject.toggleCollaborationPanel).toBeDefined();
        const time = typeof subject.toggleCollaborationPanel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
