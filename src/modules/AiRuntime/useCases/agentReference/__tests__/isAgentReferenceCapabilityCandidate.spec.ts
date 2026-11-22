import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { isAgentReferenceCapabilityCandidate } from '../isAgentReferenceCapabilityCandidate';

function trackOfKind(id: string, kind: ProjectContext['tracks'][number]['kind']): ProjectContext['tracks'][number] {
    return {
        id,
        name: id,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
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
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 0,
    masterGain: 1,
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
    tracks: [
        trackOfKind('folder', 'folder'),
        trackOfKind('audio', 'audio'),
        trackOfKind('midi', 'midi'),
        trackOfKind('bus', 'bus'),
        trackOfKind('master', 'master'),
    ],
};

describe('isAgentReferenceCapabilityCandidate folder-track', () => {
    it('admits a folder track and no other kind', () => {
        const admitted = ['folder', 'audio', 'bus', 'master', 'missing'].filter((id) =>
            isAgentReferenceCapabilityCandidate({ capability: 'folder-track', context, id })
        );

        expect(admitted).toEqual(['folder']);
    });
});

describe('isAgentReferenceCapabilityCandidate hideable-track', () => {
    it('admits every track kind but the master, and no missing id', () => {
        const admitted = ['folder', 'audio', 'midi', 'bus', 'master', 'missing'].filter((id) =>
            isAgentReferenceCapabilityCandidate({ capability: 'hideable-track', context, id })
        );

        expect(admitted).toEqual(['folder', 'audio', 'midi', 'bus']);
    });
});
