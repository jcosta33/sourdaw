import { describe, expect, it } from 'vitest';

import { generatePresets } from '../Generate';
import { type PresetContext } from '../Types';

const ctxWithTrack: PresetContext = {
    selectedTrackId: 'track-42',
    selectedTrackKind: 'midi',
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 1,
};

describe('generatePresets — drum patterns', () => {
    it('routes each drum preset to generateDrumPattern with the correct style', () => {
        const expected: Record<string, string> = {
            'gen-drum-rock': 'rock',
            'gen-drum-4floor': 'four-on-floor',
            'gen-drum-trap': 'trap',
            'gen-drum-jazz': 'jazz',
            'gen-drum-dnb': 'dnb',
            'gen-drum-latin': 'latin',
            'gen-drum-halftime': 'half-time',
        };
        for (const preset of generatePresets.filter((p) => p.id in expected)) {
            const action = preset.buildAction(ctxWithTrack);
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected action for ${preset.id}`);
            }
            expect(action.type).toBe('generateDrumPattern');
            expect(action.payload).toMatchObject({ style: expected[preset.id], trackId: 'track-42' });
        }
    });
});

describe('generatePresets — melody', () => {
    it('routes each melody preset to generateMelody with the correct style', () => {
        const expected: Record<string, string> = {
            'gen-melody': 'simple',
            'gen-melody-arp': 'arpeggiated',
            'gen-melody-ambient': 'ambient',
        };
        for (const preset of generatePresets.filter((p) => p.id in expected)) {
            const action = preset.buildAction(ctxWithTrack);
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected action for ${preset.id}`);
            }
            expect(action.type).toBe('generateMelody');
            expect(action.payload).toMatchObject({ style: expected[preset.id], trackId: 'track-42' });
        }
    });
});

describe('generatePresets — chord progressions', () => {
    it('routes each chord preset to generateChordProgression with the correct style', () => {
        const expected: Record<string, string> = {
            'gen-chords-pop': 'pop',
            'gen-chords-jazz': 'jazz',
            'gen-chords-edm': 'edm',
            'gen-chords-cinematic': 'cinematic',
            'gen-chords-blues': 'blues',
        };
        for (const preset of generatePresets.filter((p) => p.id in expected)) {
            const action = preset.buildAction(ctxWithTrack);
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected action for ${preset.id}`);
            }
            expect(action.type).toBe('generateChordProgression');
            expect(action.payload).toMatchObject({ style: expected[preset.id], trackId: 'track-42' });
        }
    });
});

describe('generatePresets — trackId forwarding', () => {
    it('forwards undefined selectedTrackId when no track is selected', () => {
        const ctxNoTrack: PresetContext = {
            selectedTrackId: undefined,
            selectedClipId: undefined,
            selectedClipType: undefined,
            trackCount: 0,
        };
        const preset = generatePresets.find((p) => p.id === 'gen-drum-rock')!;
        const action = preset.buildAction(ctxNoTrack);
        if (action === null || Array.isArray(action)) {
            throw new Error('Expected action');
        }
        expect(action.payload).toMatchObject({ trackId: undefined });
    });
});
