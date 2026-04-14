import { describe, it, expect } from 'vitest';
import * as subject from '../getMixerSnapshots';

describe('getMixerSnapshots', () => {
    it('should export getMixerSnapshots', () => {
        expect(subject.getMixerSnapshots).toBeDefined();
        const t = typeof subject.getMixerSnapshots;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
