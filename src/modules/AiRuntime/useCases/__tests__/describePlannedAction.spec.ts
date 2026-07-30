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
});
