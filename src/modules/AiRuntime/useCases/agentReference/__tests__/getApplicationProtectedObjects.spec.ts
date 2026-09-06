import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { getApplicationProtectedObjects } from '../getApplicationProtectedObjects';

function createTrack(id: string, name: string, frozen = false): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
        sends: [],
    };
}

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        createTrack('track-bass-di', 'Bass DI'),
        createTrack('track-bass-amp', 'Bass Amp'),
        createTrack('track-bass-frozen', 'Bass Frozen', true),
        createTrack('track-guitar', 'Guitar'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('getApplicationProtectedObjects', () => {
    it('includes an explicitly protected clip without dropping existing protections', () => {
        const bassVerse = {
            id: 'clip-bass-verse',
            name: 'Bass Verse',
            type: 'audio' as const,
            startBeat: 0,
            endBeat: 8,
            noteCount: 0,
        };
        const lead = { ...bassVerse, id: 'clip-lead', name: 'Lead', startBeat: 8, endBeat: 16 };
        const clipContext: ProjectContext = {
            ...context,
            selectedClipId: bassVerse.id,
            selectedClipIds: [bassVerse.id],
            tracks: context.tracks.map((track) =>
                track.id === 'track-bass-di' ? { ...track, clipCount: 2, clips: [bassVerse, lead] } : track
            ),
        };

        const protections = getApplicationProtectedObjects({
            actions: [],
            context: clipContext,
            prompt: 'rename Other to Bridge Solo; leave selected clips and Lead unchanged',
        });

        expect(protections).toContainEqual({ id: 'clip-bass-verse', name: 'Bass Verse' });
        expect(protections).toContainEqual({ id: 'clip-lead', name: 'Lead' });
    });

    it('protects matching frozen tracks for an anchor-less bulk device prompt', () => {
        expect(getApplicationProtectedObjects({ actions: [], context, prompt: 'Add EQ to every bass track' })).toEqual([
            { id: 'track-bass-frozen', name: 'Bass Frozen' },
        ]);
    });

    it('protects matching frozen tracks without the excluding-frozen phrase', () => {
        expect(
            getApplicationProtectedObjects({
                actions: [],
                context,
                prompt: 'Insert a compressor after EQ on every bass track',
            })
        ).toEqual([{ id: 'track-bass-frozen', name: 'Bass Frozen' }]);
    });

    it('protects frozen tracks only within the matched bulk family', () => {
        const frozenOutsideFamily: ProjectContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-guitar' ? createTrack(track.id, track.name, true) : track
            ),
        };

        expect(
            getApplicationProtectedObjects({
                actions: [],
                context: frozenOutsideFamily,
                prompt: 'Add EQ to every bass track',
            })
        ).toEqual([{ id: 'track-bass-frozen', name: 'Bass Frozen' }]);
    });

    it('claims no bulk frozen protection for a prompt outside the bulk insertion family', () => {
        expect(getApplicationProtectedObjects({ actions: [], context, prompt: 'Mute the bass track' })).toEqual([]);
    });
});
