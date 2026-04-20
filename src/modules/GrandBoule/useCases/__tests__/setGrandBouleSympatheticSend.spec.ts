import { describe, it, expect } from 'vitest';

import * as subject from '../setGrandBouleSympatheticSend';

describe('setGrandBouleSympatheticSend', () => {
    it('should export setGrandBouleSympatheticSend', () => {
        expect(subject.setGrandBouleSympatheticSend).toBeDefined();
        const t = typeof subject.setGrandBouleSympatheticSend;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
