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

import { generateBassPack } from '../bass';
import { generate808Kit } from '../drums808';
import { generate909Kit } from '../drums909';
import { generateLofiKit } from '../drumsLofi';
import { generateKeysPack } from '../keys';

describe('Factory synthesis kits', () => {
    it('808 kit generates samples', () => {
        const samples = generate808Kit(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.id).toBeTruthy();
            expect(s.name).toBeTruthy();
            expect(s.category).toBe('drums');
            expect(s.buffer).toBeDefined();
            expect(s.tags.length).toBeGreaterThan(0);
        }
    });

    it('909 kit generates samples', () => {
        const samples = generate909Kit(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
    });

    it('lofi kit generates samples', () => {
        const samples = generateLofiKit(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
    });

    it('bass generates samples', () => {
        const samples = generateBassPack(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('bass');
        }
    });

    it('keys generates samples', () => {
        const samples = generateKeysPack(mock_ctx);
        expect(samples.length).toBeGreaterThan(0);
        for (const s of samples) {
            expect(s.category).toBe('keys');
        }
    });

    it('all 808 samples have unique ids', () => {
        const samples = generate808Kit(mock_ctx);
        const ids = samples.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('all 808 sample buffers have positive length', () => {
        const samples = generate808Kit(mock_ctx);
        for (const s of samples) {
            expect(s.buffer.length).toBeGreaterThan(0);
        }
    });
});
