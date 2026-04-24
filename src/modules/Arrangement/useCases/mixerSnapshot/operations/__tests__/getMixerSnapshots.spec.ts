import { describe, it, expect } from 'vitest';

import * as subject from '../getMixerSnapshots';

describe('getMixerSnapshots', () => {
    it('should export getMixerSnapshots', () => {
        expect(subject.getMixerSnapshots).toBeDefined();
        const time = typeof subject.getMixerSnapshots;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
