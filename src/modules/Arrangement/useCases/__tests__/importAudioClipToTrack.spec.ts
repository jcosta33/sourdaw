import { describe, it, expect } from 'vitest';

import * as subject from '../importAudioClipToTrack';

describe('importAudioClipToTrack', () => {
    it('should export importAudioClipToTrack', () => {
        expect(subject.importAudioClipToTrack).toBeDefined();
        const t = typeof subject.importAudioClipToTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
