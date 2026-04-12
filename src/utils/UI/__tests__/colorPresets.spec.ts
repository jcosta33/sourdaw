import { describe, it, expect } from 'vitest';

import { CLIP_COLOR_PRESETS as dawClip, TRACK_COLOR_PRESETS as dawTrack } from '#/components/daw/colorPresets';

import { CLIP_COLOR_PRESETS, TRACK_COLOR_PRESETS } from '../colorPresets';

describe('utils colorPresets shim', () => {
    it('should re-export the same palette arrays as components/daw/colorPresets', () => {
        expect(TRACK_COLOR_PRESETS).toBe(dawTrack);
        expect(CLIP_COLOR_PRESETS).toBe(dawClip);
    });
});
