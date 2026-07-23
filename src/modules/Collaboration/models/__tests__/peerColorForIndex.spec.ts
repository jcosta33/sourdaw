import { describe, it, expect } from 'vitest';

import { PEER_COLORS, peerColorForIndex } from '../CollaborationTypes';

describe('peerColorForIndex', () => {
    it('returns the curated palette color for in-range indices', () => {
        expect(peerColorForIndex(0)).toBe(PEER_COLORS[0]);
        expect(peerColorForIndex(1)).toBe(PEER_COLORS[1]);
        expect(peerColorForIndex(PEER_COLORS.length - 1)).toBe(PEER_COLORS[PEER_COLORS.length - 1]);
    });

    it('returns an hsl color for overflow indices beyond the palette', () => {
        const color = peerColorForIndex(PEER_COLORS.length);
        expect(color).toMatch(/^hsl\(/);
    });

    it('spreads hues via the golden angle for consecutive overflow peers', () => {
        const first = peerColorForIndex(PEER_COLORS.length);
        const second = peerColorForIndex(PEER_COLORS.length + 1);
        // Both are hsl; their hues differ by ~137.5° (mod 360).
        const hueOf = (hsl: string): number => {
            const match = hsl.match(/hsl\((\d+)/);
            return match ? Number(match[1]) : -1;
        };
        const hue1 = hueOf(first);
        const hue2 = hueOf(second);
        const diff = Math.abs(hue2 - hue1);
        expect(diff).toBeCloseTo(137.508, 0);
    });

    it('wraps the golden-angle hue modulo 360 for large overflow indices', () => {
        // An overflow index ≥ 3 makes (overflow * 137.508) exceed 360, so the
        // % 360 wrap path is genuinely exercised (not just raw multiplication).
        const large = peerColorForIndex(PEER_COLORS.length + 3);
        const match = large.match(/hsl\((\d+)/);
        const hue = match ? Number(match[1]) : -1;
        // (3 * 137.508) % 360 = 412.524 % 360 = 52.524 → rounded 53.
        expect(hue).toBeLessThan(137);
        expect(hue).toBeGreaterThanOrEqual(0);
    });

    it('returns distinct colors for different overflow indices', () => {
        const a = peerColorForIndex(PEER_COLORS.length + 2);
        const b = peerColorForIndex(PEER_COLORS.length + 5);
        expect(a).not.toBe(b);
    });

    it('wraps hue modulo 360 without producing out-of-range values', () => {
        // A large overflow index must still yield a valid 0-359 hue.
        const color = peerColorForIndex(PEER_COLORS.length + 100);
        const match = color.match(/hsl\((\d+)/);
        const hue = match ? Number(match[1]) : -1;
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(360);
    });
});
