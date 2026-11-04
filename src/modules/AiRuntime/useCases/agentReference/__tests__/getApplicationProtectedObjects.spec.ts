import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { getApplicationProtectedObjects } from '../getApplicationProtectedObjects';
import { getBulkDeviceInsertionTrackScope } from '../getBulkDeviceInsertionTrackScope';

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
    const bassVerse: ProjectContextTrack['clips'][number] = {
        id: 'clip-owner-bass-verse',
        name: 'Bass Verse',
        type: 'audio',
        startBeat: 0,
        endBeat: 8,
        noteCount: 0,
    };
    const bass = { ...createTrack('track-owner-bass', 'Bass'), clips: [bassVerse], clipCount: 1 };
    const ownerContext: ProjectContext = { ...context, tracks: [bass] };

    it('keeps a protected clip name from promoting its contained track name to a whole owner', () => {
        expect(
            getApplicationProtectedObjects({ actions: [], context: ownerContext, prompt: 'leave Bass Verse unchanged' })
        ).toEqual([{ id: bassVerse.id, name: bassVerse.name }]);
    });

    it('keeps an unchanged control facet out of whole-object protections', () => {
        expect(
            getApplicationProtectedObjects({ actions: [], context: ownerContext, prompt: 'leave Bass fader unchanged' })
        ).toEqual([]);
    });

    it('retains both applicable whole-track and clip candidates with exactly the same name', () => {
        const namedBass = { ...bassVerse, id: 'clip-owner-bass', name: 'Bass' };
        const collision: ProjectContext = { ...context, tracks: [{ ...bass, clips: [namedBass] }] };

        expect(
            getApplicationProtectedObjects({ actions: [], context: collision, prompt: 'leave Bass unchanged' })
        ).toEqual([
            { id: bass.id, name: bass.name },
            { id: namedBass.id, name: namedBass.name },
        ]);
    });

    it('retains an independent whole-track restriction beside its protected clip', () => {
        expect(
            getApplicationProtectedObjects({
                actions: [],
                context: ownerContext,
                prompt: 'leave Bass alone; leave Bass Verse unchanged',
            })
        ).toEqual([
            { id: bass.id, name: bass.name },
            { id: bassVerse.id, name: bassVerse.name },
        ]);
    });

    it('retains an independent structural whole-track restriction beside its protected clip', () => {
        const liveBass = createTrack('track-live-bass', 'Bass DI');
        const structuralContext: ProjectContext = {
            ...ownerContext,
            tracks: [{ ...bass, frozen: true }, liveBass],
        };
        const prompt = 'Add EQ to every bass track; leave Bass Verse unchanged';
        expect(getBulkDeviceInsertionTrackScope(prompt, structuralContext)).toEqual({
            targetIds: [liveBass.id],
            anchors: [],
            excludedFrozenTrackIds: [bass.id],
        });
        expect(
            getApplicationProtectedObjects({
                actions: [],
                context: structuralContext,
                prompt,
            })
        ).toEqual([
            { id: bass.id, name: bass.name },
            { id: bassVerse.id, name: bassVerse.name },
        ]);
    });

    it('retains canonical whole tracks while keeping complement facets separate', () => {
        expect(
            getApplicationProtectedObjects({ actions: [], context: ownerContext, prompt: 'leave Bass unchanged' })
        ).toEqual([{ id: bass.id, name: bass.name }]);
        expect(
            getApplicationProtectedObjects({
                actions: [],
                context: ownerContext,
                prompt: 'leave Bass unchanged except for the fader',
            })
        ).toEqual([]);
    });

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
