import { describe, it, expect } from 'vitest';

import * as subject from '../importAudioClipToTrack';

describe('importAudioClipToTrack', () => {
    it('should export importAudioClipToTrack', () => {
        expect(subject.importAudioClipToTrack).toBeDefined();
        const time = typeof subject.importAudioClipToTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
