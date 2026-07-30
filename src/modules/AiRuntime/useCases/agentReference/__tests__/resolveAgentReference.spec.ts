import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { resolveAgentReference } from '../resolveAgentReference';

function createProjectState(): ProjectContext {
    const tracks = [
        { id: 'track-vocals', name: 'Vocals' },
        { id: 'track-bass', name: 'Bass' },
    ].map(({ id, name }) => ({
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    }));

    return {
        tempo: 120,
        timeSignature: [4, 4],
        tracks,
        selectedTrackId: 'track-vocals',
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

function resolveTrack(prompt: string, assertedId: string, project = createProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'track', context: project });
}

function createClipProjectState(): ProjectContext {
    const project = createProjectState();
    const vocals = project.tracks[0];
    const bass = project.tracks[1];
    if (!vocals || !bass) {
        throw new Error('Expected track fixtures');
    }
    const intro = {
        id: 'clip-intro',
        name: 'Intro',
        type: 'audio' as const,
        startBeat: 0,
        endBeat: 8,
        gain: 1,
        locked: false,
        noteCount: 0,
    };
    const vocalsVerse = { ...intro, id: 'clip-vocals-verse', name: 'Verse', startBeat: 8, endBeat: 16 };
    const bassVerse = { ...intro, id: 'clip-bass-verse', name: 'Verse', startBeat: 16, endBeat: 24 };
    const locked = { ...intro, id: 'clip-locked', name: 'Locked', locked: true };
    return {
        ...project,
        tracks: [
            { ...vocals, clipCount: 3, clips: [intro, vocalsVerse, locked] },
            { ...bass, clipCount: 1, clips: [bassVerse] },
        ],
        selectedClipId: intro.id,
        selectedClipIds: [intro.id],
    };
}

function resolveClip(prompt: string, assertedId: string, project = createClipProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'editable-clip', context: project });
}

describe('resolveAgentReference', () => {
    it('resolves unique exact names and explicit selection language', () => {
        expect(resolveTrack('mute Vocals', 'track-vocals')).toEqual({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'exact-name',
        });
        expect(resolveTrack('mute the selected track', 'track-vocals')).toEqual({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'selection',
        });
    });

    it('rejects ambiguous names, mismatched assertions, and incidental substrings', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const ambiguousContext = {
            ...projectState,
            tracks: [...projectState.tracks, { ...firstTrack, id: 'track-vocals-double' }],
        };
        const overlappingContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead', name: 'Lead' },
                { ...firstTrack, id: 'track-lead-vox', name: 'Lead Vox' },
            ],
        };

        expect(resolveTrack('mute Vocals', 'track-vocals', ambiguousContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Vocals', 'track-bass', projectState)).toEqual({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
        expect(resolveTrack('mute Vocals Bass', 'track-vocals', projectState)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Lead Vox', 'track-lead', overlappingContext)).toEqual({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
        expect(resolveTrack('mute Lead Vox', 'track-lead-vox', overlappingContext)).toEqual({
            status: 'resolved',
            id: 'track-lead-vox',
            evidence: 'exact-name',
        });
        expect(resolveTrack('adjust the embassy', 'track-bass', projectState)).toEqual({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('resolves editable clips by literal ID, unique exact name, and one explicit selection', () => {
        expect(resolveClip('trim clip-intro start to beat 2', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'literal-id',
        });
        expect(resolveClip('rename Intro to Opening', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'exact-name',
        });
        expect(resolveClip('nudge the selected clip by 2 beats', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'selection',
        });
    });

    it('uses an exact track qualifier to disambiguate duplicate clip names', () => {
        expect(resolveClip('rename Verse on Vocals to Lead Verse', 'clip-vocals-verse')).toEqual({
            status: 'resolved',
            id: 'clip-vocals-verse',
            evidence: 'exact-name',
        });
        expect(resolveClip('rename Verse on Bass to Bass Verse', 'clip-bass-verse')).toEqual({
            status: 'resolved',
            id: 'clip-bass-verse',
            evidence: 'exact-name',
        });
        expect(resolveClip('rename Verse to Lead Verse', 'clip-vocals-verse')).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('rejects multi-selection and locked clip edit targets', () => {
        const project = createClipProjectState();
        const multiSelection = {
            ...project,
            selectedClipId: 'clip-intro',
            selectedClipIds: ['clip-intro', 'clip-vocals-verse'],
        };

        expect(resolveClip('nudge the selected clip by 2 beats', 'clip-intro', multiSelection)).toMatchObject({
            status: 'rejected',
        });
        expect(resolveClip('rename Locked to Open', 'clip-locked', project)).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });
});
