import { describe, it, expect } from 'vitest';

import * as subject from '../getMasterStereoAnalysers';

describe('getMasterStereoAnalysers', () => {
    it('should export getMasterStereoAnalysers', () => {
        expect(subject.getMasterStereoAnalysers).toBeDefined();
        expect(typeof subject.getMasterStereoAnalysers).toBe('function');
    });
});
