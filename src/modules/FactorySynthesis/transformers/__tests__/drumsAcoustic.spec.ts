import { describe, it, expect } from 'vitest';

import { generateAcousticKit } from '../drumsAcoustic';

describe('generateAcousticKit', () => {
    it('generates 8 acoustic drum samples with correct ids and categories', () => {
        const samples = generateAcousticKit();
        expect(samples).toHaveLength(8);
        const ids = samples.map((s) => s.id);
        expect(ids).toEqual([
            'factory-acoustic-kick',
            'factory-acoustic-snare',
            'factory-acoustic-brush-hat',
            'factory-acoustic-tambourine',
            'factory-acoustic-ride',
            'factory-acoustic-tom-high',
            'factory-acoustic-tom-mid',
            'factory-acoustic-tom-low',
        ]);
        for (const sample of samples) {
            expect(sample.category).toBe('drums');
        }
    });

    it('assigns the correct display names', () => {
        const samples = generateAcousticKit();
        const names = samples.map((s) => s.name);
        expect(names).toEqual([
            'Acoustic Kick',
            'Acoustic Snare',
            'Acoustic Brush Hat',
            'Acoustic Tambourine',
            'Acoustic Ride',
            'Acoustic Tom High',
            'Acoustic Tom Mid',
            'Acoustic Tom Low',
        ]);
    });

    it('tags every sample with the acoustic kit base tags plus instrument-specific tags', () => {
        const samples = generateAcousticKit();
        for (const sample of samples) {
            expect(sample.tags).toContain('acoustic');
            expect(sample.tags).toContain('natural');
            expect(sample.tags).toContain('organic');
            expect(sample.tags).toContain('drum');
        }
        // Instrument-specific tags
        const kick = samples.find((s) => s.id === 'factory-acoustic-kick')!;
        expect(kick.tags).toContain('kick');
        const snare = samples.find((s) => s.id === 'factory-acoustic-snare')!;
        expect(snare.tags).toContain('snare');
        const ride = samples.find((s) => s.id === 'factory-acoustic-ride')!;
        expect(ride.tags).toContain('ride');
        expect(ride.tags).toContain('cymbal');
        const tambourine = samples.find((s) => s.id === 'factory-acoustic-tambourine')!;
        expect(tambourine.tags).toContain('tambourine');
        expect(tambourine.tags).toContain('percussion');
    });

    it('renders one mono channel at 44.1 kHz for each sample', () => {
        const samples = generateAcousticKit();
        for (const sample of samples) {
            expect(sample.channels).toHaveLength(1);
            expect(sample.channels[0]!.length).toBeGreaterThan(0);
            expect(sample.sampleRate).toBe(44100);
        }
    });
});
