import { describe, it, expect } from 'vitest';
import * as subject from '../toggleChatPanel';

describe('toggleChatPanel', () => {
    it('should export toggleChatPanel', () => {
        expect(subject.toggleChatPanel).toBeDefined();
        const t = typeof subject.toggleChatPanel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
