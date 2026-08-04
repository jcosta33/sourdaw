import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    markerStoreValue: {
        value: null as {
            markers: { id: string; beat: number; color: string; name: string }[];
            sections: { id: string; startBeat: number; endBeat: number; name: string }[];
        } | null,
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
    },
}));

import { type ProjectContext } from '../../models/ProjectContext';
import { describePlannedAction } from '../describePlannedAction';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        {
            id: 'track-drums',
            name: 'Drums',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [
                {
                    id: 'clip-verse',
                    name: 'Verse Lead',
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 8,
                    noteCount: 0,
                },
            ],
            devices: [],
            sends: [],
        },
    ],
    selectedTrackId: 'track-drums',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('describePlannedAction', () => {
    beforeEach(() => {
        mocks.markerStoreValue.value = null;
    });

    it('names a resolved removal target and falls back when the target is unavailable', () => {
        expect(
            describePlannedAction({
                action: { type: 'removeTrack', payload: { trackId: 'track-drums' } },
                context,
            })
        ).toBe('Remove track "Drums"');
        expect(
            describePlannedAction({
                action: { type: 'removeTrack', payload: { trackId: 'missing' } },
                context,
            })
        ).toBe('Remove track');
    });

    it('names a resolved clip removal target and falls back when the clip is unavailable', () => {
        expect(
            describePlannedAction({
                action: { type: 'removeClip', payload: { clipId: 'clip-verse' } },
                context,
            })
        ).toBe('Remove clip "Verse Lead"');
        expect(
            describePlannedAction({
                action: { type: 'removeClip', payload: { clipId: 'missing' } },
                context,
            })
        ).toBe('Remove clip');
    });

    it('names the normalization target, measurement, and optional level', () => {
        expect(
            describePlannedAction({
                action: { type: 'normalizeClip', payload: { clipId: 'clip-verse' } },
                context,
            })
        ).toBe('Normalize clip "Verse Lead" using peak measurement');
        expect(
            describePlannedAction({
                action: {
                    type: 'normalizeClip',
                    payload: { clipId: 'clip-verse', mode: 'lufs', targetDb: -14 },
                },
                context,
            })
        ).toBe('Normalize clip "Verse Lead" to -14 LUFS');
        expect(
            describePlannedAction({
                action: { type: 'normalizeClip', payload: { clipId: 'missing', mode: 'rms' } },
                context,
            })
        ).toBe('Normalize clip to -14 dB RMS');
    });

    it('names the exact local marker removal target and falls back when it is unavailable', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'marker-chorus', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };

        expect(
            describePlannedAction({
                action: { type: 'removeMarker', payload: { markerId: 'marker-chorus' } },
                context,
            })
        ).toBe('Remove marker "Chorus" at beat 16 (marker-chorus)');
        expect(
            describePlannedAction({
                action: { type: 'removeMarker', payload: { markerId: 'missing' } },
                context,
            })
        ).toBe('Remove marker');
    });

    it('names the exact local marker and requested palette color', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'marker-chorus', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };

        expect(
            describePlannedAction({
                action: {
                    type: 'setMarkerColor',
                    payload: { markerId: 'marker-chorus', color: 'oklch(0.40 0.08 70)' },
                },
                context,
            })
        ).toBe('Set marker "Chorus" at beat 16 (marker-chorus) color to amber');
    });

    it('names section range, local identity, and rename target for confirmation', () => {
        mocks.markerStoreValue.value = {
            markers: [],
            sections: [{ id: 'section-verse', startBeat: 8, endBeat: 16, name: 'Verse' }],
        };

        expect(
            describePlannedAction({
                action: { type: 'addSection', payload: { startBeat: 16, endBeat: 32, name: 'Chorus' } },
                context,
            })
        ).toBe('Add section "Chorus" from beat 16 to beat 32');
        expect(
            describePlannedAction({
                action: { type: 'removeSection', payload: { sectionId: 'section-verse' } },
                context,
            })
        ).toBe('Remove section "Verse" from beat 8 to beat 16 (section-verse)');
        expect(
            describePlannedAction({
                action: { type: 'renameSection', payload: { sectionId: 'section-verse', name: 'Pre-Chorus' } },
                context,
            })
        ).toBe('Rename section "Verse" to "Pre-Chorus" from beat 8 to beat 16 (section-verse)');
    });

    it('names the exact MIDI clip, stable ID, and transform value for confirmation', () => {
        const midiContext: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({
                    ...clip,
                    type: 'midi' as const,
                    noteCount: 4,
                })),
            })),
        };

        expect(
            describePlannedAction({
                action: { type: 'quantizeNotes', payload: { clipId: 'clip-verse', gridSize: 0.25 } },
                context: midiContext,
            })
        ).toBe('Quantize notes in "Verse Lead" (clip-verse) to a 0.25-beat grid');
        expect(
            describePlannedAction({
                action: { type: 'transposeNotes', payload: { clipId: 'clip-verse', semitones: 7 } },
                context: midiContext,
            })
        ).toBe('Transpose notes in "Verse Lead" (clip-verse) by +7 semitones');
        expect(
            describePlannedAction({
                action: { type: 'invertNotes', payload: { clipId: 'clip-verse' } },
                context: midiContext,
            })
        ).toBe('Invert notes in "Verse Lead" (clip-verse)');
        expect(
            describePlannedAction({
                action: { type: 'retrogradeNotes', payload: { clipId: 'clip-verse' } },
                context: midiContext,
            })
        ).toBe('Retrograde notes in "Verse Lead" (clip-verse)');
        expect(
            describePlannedAction({
                action: { type: 'quantizeNoteLengths', payload: { clipId: 'clip-verse', gridSize: 0.5 } },
                context: midiContext,
            })
        ).toBe('Quantize note lengths in "Verse Lead" (clip-verse) to a 0.5-beat grid');
        expect(
            describePlannedAction({
                action: { type: 'scaleAllVelocities', payload: { clipId: 'clip-verse', factor: 0.75 } },
                context: midiContext,
            })
        ).toBe('Scale note velocities in "Verse Lead" (clip-verse) by ×0.75');
        expect(
            describePlannedAction({
                action: { type: 'setAllVelocities', payload: { clipId: 'clip-verse', velocity: 96 } },
                context: midiContext,
            })
        ).toBe('Set note velocities in "Verse Lead" (clip-verse) to 96');
    });

    it('names both sidechain endpoints with IDs and direction for confirmation', () => {
        const bassTrack = {
            ...context.tracks[0]!,
            id: 'track-bass',
            name: 'Bass',
            clips: [],
            clipCount: 0,
        };
        const sidechainContext = { ...context, tracks: [context.tracks[0]!, bassTrack] };

        expect(
            describePlannedAction({
                action: {
                    type: 'addSidechainRoute',
                    payload: { sourceTrackId: 'track-drums', targetTrackId: 'track-bass' },
                },
                context: sidechainContext,
            })
        ).toBe('Add sidechain route: "Drums" (track-drums) → "Bass" (track-bass)');
        expect(
            describePlannedAction({
                action: {
                    type: 'removeSidechainRoute',
                    payload: { sourceTrackId: 'track-drums', targetTrackId: 'track-bass' },
                },
                context: sidechainContext,
            })
        ).toBe('Remove sidechain route: "Drums" (track-drums) → "Bass" (track-bass)');
    });
});
