import { describe, it, expect, vi, beforeEach } from 'vitest';

import { duplicateClipCore } from '../duplicateClipCore';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    addClip: vi.fn(),
    duplicateClipAutomation: vi.fn(),
    duplicateClipNotes: vi.fn(),
    getWarpState: vi.fn(),
    setWarpState: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../addClip', () => ({
    addClip: mocks.addClip,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    duplicateClipAutomation: mocks.duplicateClipAutomation,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    duplicateClipNotes: mocks.duplicateClipNotes,
}));

vi.mock('../../../stores/warpStates', () => ({
    getWarpState: mocks.getWarpState,
    setWarpState: mocks.setWarpState,
}));

describe('duplicateClipCore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getWarpState.mockReturnValue({
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
    });

    it('exports duplicateClipCore', () => {
        expect(typeof duplicateClipCore).toBe('function');
    });

    it('forwards the full editable property set to addClip (no silent loss)', () => {
        const source = {
            id: 'c1',
            trackId: 't1',
            name: 'Take',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
            audioBufferId: 'buf-1',
            assetHash: 'hash-abc',
            audioOffsetBeats: 1.25,
            midiOffsetBeats: 0.5,
            fadeInBeats: 0.5,
            fadeOutBeats: 1,
            gain: 0.3,
            color: '#abcdef',
            locked: true,
            muted: true,
            stretchMode: 'timestretch' as const,
            stretchRatio: 1.5,
            loopEnabled: true,
            loopLength: 8,
            followAction: 'play_next' as const,
        };
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [source] }] });
        mocks.addClip.mockReturnValue({ id: 'c2', type: 'audio' });

        // computeStartBeat = clip.endBeat (matches duplicateClip's behavior)
        duplicateClipCore('c1', (clip) => clip.endBeat);

        expect(mocks.addClip).toHaveBeenCalledTimes(1);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't1',
                startBeat: 4,
                endBeat: 8,
                name: 'Take (copy)',
                type: 'audio',
                audioBufferId: 'buf-1',
                assetHash: 'hash-abc',
                audioOffsetBeats: 1.25,
                midiOffsetBeats: 0.5,
                fadeInBeats: 0.5,
                fadeOutBeats: 1,
                gain: 0.3,
                color: '#abcdef',
                locked: true,
                muted: true,
                stretchMode: 'timestretch',
                stretchRatio: 1.5,
                loopEnabled: true,
                loopLength: 8,
                followAction: 'play_next',
            })
        );
    });

    it('copies warp markers to the duplicate', () => {
        const source = {
            id: 'c1',
            trackId: 't1',
            name: 'Take',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [source] }] });
        mocks.addClip.mockReturnValue({ id: 'c2', type: 'audio' });
        mocks.getWarpState.mockReturnValue({
            enabled: true,
            markers: [{ id: 'w1', originalBeat: 1, warpedBeat: 1.2 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });

        duplicateClipCore('c1', (clip) => clip.endBeat);

        expect(mocks.setWarpState).toHaveBeenCalledWith(
            'c2',
            expect.objectContaining({
                enabled: true,
                stretchMode: 'beats',
                originalTempo: 120,
                markers: [{ id: 'w1', originalBeat: 1, warpedBeat: 1.2 }],
            })
        );
    });
});
