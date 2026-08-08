import { describe, expect, it } from 'vitest';

import { TOASTER_ENGINE_MAP } from '../toasterEngineMap';

import type { DrumEngineType } from '../../models/ToasterKit';

describe('TOASTER_ENGINE_MAP', () => {
    it('maps every DrumEngineType to a Rust engine index', () => {
        // The map must be exhaustive: every variant of DrumEngineType is a key.
        const allEngines = Object.keys(TOASTER_ENGINE_MAP) as DrumEngineType[];
        expect(allEngines.length).toBeGreaterThanOrEqual(25);

        // Every value is a non-negative integer within the 0–28 range the
        // comment documents (0-12 generic, 13-28 circuit-faithful).
        for (const engine of allEngines) {
            const index = TOASTER_ENGINE_MAP[engine];
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThanOrEqual(28);
            expect(Number.isInteger(index)).toBe(true);
        }
    });

    it('maps 808 kick to index 13 and 909 kick to 14', () => {
        expect(TOASTER_ENGINE_MAP['kick-808']).toBe(13);
        expect(TOASTER_ENGINE_MAP['kick-909']).toBe(14);
    });

    it('maps CR-78 engines to indices 27-28', () => {
        expect(TOASTER_ENGINE_MAP['cr78-drum']).toBe(27);
        expect(TOASTER_ENGINE_MAP['cr78-metallic']).toBe(28);
    });

    it('maps generic analog voices to indices 0-6', () => {
        expect(TOASTER_ENGINE_MAP['kick-analog']).toBe(0);
        expect(TOASTER_ENGINE_MAP['snare-analog']).toBe(1);
        expect(TOASTER_ENGINE_MAP.tom).toBe(5);
        expect(TOASTER_ENGINE_MAP.cymbal).toBe(6);
    });

    it('maps all three tom-808 variants to distinct indices in the 808 range', () => {
        const low = TOASTER_ENGINE_MAP['tom-808-low'];
        const mid = TOASTER_ENGINE_MAP['tom-808-mid'];
        const high = TOASTER_ENGINE_MAP['tom-808-high'];

        expect(low).toBe(20);
        expect(mid).toBe(21);
        expect(high).toBe(22);
        // Distinct indices — no collision.
        expect(new Set([low, mid, high]).size).toBe(3);
    });

    it('maps modal engines to index 7 (shared modal synthesis voice)', () => {
        for (const engine of ['modal-tabla', 'modal-bongo', 'modal-woodblock', 'modal-metal'] as DrumEngineType[]) {
            expect(TOASTER_ENGINE_MAP[engine]).toBe(7);
        }
    });

    it('maps hihat-closed and hihat-open to the same 808 hihat index (16)', () => {
        expect(TOASTER_ENGINE_MAP['hihat-closed']).toBe(16);
        expect(TOASTER_ENGINE_MAP['hihat-open']).toBe(16);
    });

    it('maps clap variants to distinct circuit-faithful indices', () => {
        expect(TOASTER_ENGINE_MAP.clap).toBe(18);
        expect(TOASTER_ENGINE_MAP['clap-909']).toBe(19);
        expect(TOASTER_ENGINE_MAP.clap).not.toBe(TOASTER_ENGINE_MAP['clap-909']);
    });
});
