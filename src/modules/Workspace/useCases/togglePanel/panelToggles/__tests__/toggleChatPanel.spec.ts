import { describe, it, expect } from 'vitest';

import * as subject from '../toggleChatPanel';

describe('toggleChatPanel', () => {
    it('should export toggleChatPanel', () => {
        expect(subject.toggleChatPanel).toBeDefined();
        const time = typeof subject.toggleChatPanel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
