import { describe, it, expect, vi } from 'vitest';

const mock_ctx = {
    sampleRate: 48000,
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
    })),
} as unknown as AudioContext;

import { generateImpactsPack } from '../generateImpactsPack';
import { generateRisersPack } from '../generateRisersPack';
import { generateElectronicPerc } from '../percElectronic';
import { generateWorldPerc } from '../percWorld';

describe('factory synthesis additional packs', () => {
    it('world percussion generates samples', () => {
        const samples = generateWorldPerc(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.id).toBeTruthy();
            expect(s.category).toBe('drums');
        }
    });

    it('electronic percussion generates samples', () => {
        const samples = generateElectronicPerc(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('drums');
        }
    });

    it('risers pack generates samples', () => {
        const samples = generateRisersPack(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('fx');
        }
    });

    it('impacts pack generates samples', () => {
        const samples = generateImpactsPack(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('fx');
        }
    });

    it('world percussion has unique IDs', () => {
        const samples = generateWorldPerc(mock_ctx);
        const ids = samples.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('risers have unique IDs', () => {
        const samples = generateRisersPack(mock_ctx);
        const ids = samples.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
