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
});
