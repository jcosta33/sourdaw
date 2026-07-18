import { describe, it, expect, afterEach } from 'vitest';

import { markerStore, type MarkerStoreState } from '#/modules/Arrangement/stores';

import { detectTransitionPoints } from '../detectTransitionPoints';
import { generateAllTransitionFills } from '../generateAllTransitionFills';
import { generateDrumFill } from '../generateDrumFill';
import { generateRiser } from '../generateRiser';
import { generateSweepDown } from '../generateSweepDown';

describe('generation', () => {
    afterEach(() => {
        markerStore.set({ markers: [], sections: [] });
    });

    it('should generate a descending drum fill with tom notes and a crash ending', () => {
        const fill = generateDrumFill(8, 2, 'descending');

        expect(fill).toEqual({
            notes: [
                { pitch: 48, startBeat: 8, duration: 0.25, velocity: 88 },
                { pitch: 45, startBeat: 8.25, duration: 0.25, velocity: 89 },
                { pitch: 41, startBeat: 8.5, duration: 0.25, velocity: 90 },
                { pitch: 43, startBeat: 8.75, duration: 0.25, velocity: 90 },
                { pitch: 48, startBeat: 9, duration: 0.25, velocity: 110 },
                { pitch: 45, startBeat: 9.25, duration: 0.25, velocity: 110 },
                { pitch: 41, startBeat: 9.5, duration: 0.25, velocity: 110 },
                { pitch: 43, startBeat: 9.75, duration: 0.25, velocity: 109 },
                { pitch: 49, startBeat: 10, duration: 1, velocity: 120 },
            ],
            durationBeats: 2,
            style: 'drum-fill',
            confidence: 0.85,
        });
    });

    it('should fall back to a descending drum fill for unknown runtime style strings', () => {
        const fill = generateDrumFill(8, 2, 'made-up-style');

        expect(fill.notes.slice(0, 4)).toEqual([
            { pitch: 48, startBeat: 8, duration: 0.25, velocity: 88 },
            { pitch: 45, startBeat: 8.25, duration: 0.25, velocity: 89 },
            { pitch: 41, startBeat: 8.5, duration: 0.25, velocity: 90 },
            { pitch: 43, startBeat: 8.75, duration: 0.25, velocity: 90 },
        ]);
        expect(fill.notes.at(-1)).toEqual({ pitch: 49, startBeat: 10, duration: 1, velocity: 120 });
    });

    it('should generate riser notes that climb in pitch and velocity', () => {
        const fill = generateRiser(4, 1, 60, 72);

        expect(fill.notes).toEqual([
            { pitch: 60, startBeat: 4, duration: 0.25, velocity: 60 },
            { pitch: 63, startBeat: 4.25, duration: 0.25, velocity: 77 },
            { pitch: 66, startBeat: 4.5, duration: 0.25, velocity: 94 },
            { pitch: 69, startBeat: 4.75, duration: 0.25, velocity: 110 },
        ]);
        expect(fill.style).toBe('riser');
        expect(fill.durationBeats).toBe(1);
    });

    it('should generate sweep-down notes that descend in pitch and velocity', () => {
        const fill = generateSweepDown(12, 1, 72, 60);

        expect(fill.notes).toEqual([
            { pitch: 72, startBeat: 12, duration: 0.25, velocity: 100 },
            { pitch: 69, startBeat: 12.25, duration: 0.25, velocity: 90 },
            { pitch: 66, startBeat: 12.5, duration: 0.25, velocity: 80 },
            { pitch: 63, startBeat: 12.75, duration: 0.25, velocity: 70 },
        ]);
        expect(fill.style).toBe('sweep-down');
        expect(fill.durationBeats).toBe(1);
    });

    it('should detect marker section transitions in start-beat order', () => {
        markerStore.set({
            markers: [],
            sections: [
                { id: 'chorus', startBeat: 16, endBeat: 32, name: 'Chorus', color: '#f00' },
                { id: 'verse', startBeat: 0, endBeat: 16, name: 'Verse', color: '#0f0' },
                { id: 'break', startBeat: 32, endBeat: 48, name: 'Break', color: '#00f' },
            ],
        } satisfies MarkerStoreState);

        expect(detectTransitionPoints()).toEqual([
            { beat: 14, fromSection: 'Verse', toSection: 'Chorus' },
            { beat: 30, fromSection: 'Chorus', toSection: 'Break' },
        ]);
    });

    it('should route generated transition fills by destination section name', () => {
        markerStore.set({
            markers: [],
            sections: [
                { id: 'intro', startBeat: 0, endBeat: 8, name: 'Intro', color: '#111' },
                { id: 'chorus', startBeat: 8, endBeat: 24, name: 'Big Chorus', color: '#222' },
                { id: 'break', startBeat: 24, endBeat: 40, name: 'Breakdown', color: '#333' },
                { id: 'verse', startBeat: 40, endBeat: 56, name: 'Verse 2', color: '#444' },
            ],
        } satisfies MarkerStoreState);

        const fills = generateAllTransitionFills();

        expect(fills.map((fill) => fill.style)).toEqual(['riser', 'sweep-down', 'drum-fill']);
        expect(fills.map((fill) => fill.durationBeats)).toEqual([4, 2, 2]);
        expect(fills.map((fill) => fill.notes[0]?.startBeat)).toEqual([6, 22, 38]);
    });
});
