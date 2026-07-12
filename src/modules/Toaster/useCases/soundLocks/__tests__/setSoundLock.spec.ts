import { describe, it, expect } from 'vitest';

import { setSoundLock } from '../setSoundLock';

describe('setSoundLock', () => {
    it('is a function', () => {
        expect(typeof setSoundLock).toBe('function');
    });
});
