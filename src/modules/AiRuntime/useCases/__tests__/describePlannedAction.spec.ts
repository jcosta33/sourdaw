import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { describePlannedAction } from '../describePlannedAction';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tracks: [
        {
            id: 'track-drums',
            name: 'Drums',
            kind: 'audio',
            muted: false,
            soloed: false,
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
