import { describe, it, expect } from 'vitest';

import { createDefaultArticulator, createDefaultChannelStrip } from '../CrumbsTypes';

describe('createDefaultArticulator', () => {
    it('returns an articulator with all envelope stages nulled', () => {
        const art = createDefaultArticulator();
        expect(art.attack).toBeNull();
        expect(art.hold).toBeNull();
        expect(art.decay).toBeNull();
        expect(art.sustain).toBeNull();
        expect(art.release).toBeNull();
    });

    it('returns an articulator with all filter stages nulled', () => {
        const art = createDefaultArticulator();
        expect(art.filterCutoff).toBeNull();
        expect(art.filterResonance).toBeNull();
        expect(art.filterType).toBeNull();
    });

    it('returns default LFO values (rate 1.0, depth 0.0, sine, no target)', () => {
        const art = createDefaultArticulator();
        expect(art.lfoRate).toBe(1.0);
        expect(art.lfoDepth).toBe(0.0);
        expect(art.lfoShape).toBe('sine');
        expect(art.lfoTarget).toBe('none');
    });

    it('returns a fresh object each call (no shared reference)', () => {
        expect(createDefaultArticulator()).not.toBe(createDefaultArticulator());
        expect(createDefaultArticulator()).toEqual(createDefaultArticulator());
    });
});

describe('createDefaultChannelStrip', () => {
    it('returns a strip with unity gain and centered pan', () => {
        const strip = createDefaultChannelStrip();
        expect(strip.gain).toBe(1.0);
        expect(strip.pan).toBe(0.0);
    });

    it('returns an unmuted, unsoloed strip', () => {
        const strip = createDefaultChannelStrip();
        expect(strip.muted).toBe(false);
        expect(strip.solo).toBe(false);
    });

    it('returns 4 zeroed send slots', () => {
        const strip = createDefaultChannelStrip();
        expect(strip.sends).toEqual([0, 0, 0, 0]);
    });

    it('embeds a default articulator', () => {
        const strip = createDefaultChannelStrip();
        expect(strip.articulator).toEqual(createDefaultArticulator());
    });

    it('returns a fresh object each call (no shared reference)', () => {
        const a = createDefaultChannelStrip();
        const b = createDefaultChannelStrip();
        expect(a).not.toBe(b);
        expect(a.articulator).not.toBe(b.articulator);
    });
});
