import { describe, it, expect, vi, beforeEach } from 'vitest';

import { duplicateClipCore } from '../duplicateClipCore';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    addClip: vi.fn(),
    duplicateClipAutomation: vi.fn(),
    duplicateClipNotes: vi.fn(),
    getWarpState: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
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

vi.mock('#/modules/MIDI/useCases', () => ({
    duplicateClipNotes: mocks.duplicateClipNotes,
}));

vi.mock('../../../stores/warpStates', () => ({
    getWarpState: mocks.getWarpState,
    setWarpState: mocks.setWarpState,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
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
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'missing' };
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
        expect(
            duplicateClipCore({
                clipId: 'c1',
                targetClipId: 'c2',
                computeStartBeat: (clip) => clip.endBeat,
            })
        ).toBe(true);

        expect(mocks.addClip).toHaveBeenCalledTimes(1);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'c2',
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

        duplicateClipCore({
            clipId: 'c1',
            computeStartBeat: (clip) => clip.endBeat,
        });

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

    it('rejects an ineligible source before computing or publishing any effect', () => {
        const computeStartBeat = vi.fn(() => 4);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        mocks.getTrackState.mockReturnValue({ tracks: [] });

        expect(
            duplicateClipCore({
                clipId: 'vca-clip',
                targetClipId: 'clip-copy',
                computeStartBeat,
            })
        ).toBe(false);

        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomation).not.toHaveBeenCalled();
        expect(mocks.getWarpState).not.toHaveBeenCalled();
        expect(mocks.setWarpState).not.toHaveBeenCalled();
        expect(mocks.duplicateClipNotes).not.toHaveBeenCalled();
    });

    it('rejects a duplicate explicit target id before computing or publishing', () => {
        const computeStartBeat = vi.fn(() => 4);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1' || input.clipId === 'clip-copy') {
                return { status: 'eligible', clipId: input.clipId, trackId: 't1' };
            }
            return { status: 'eligible', trackId: 't1' };
        });
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 }] }],
        });

        expect(
            duplicateClipCore({
                clipId: 'c1',
                targetClipId: 'clip-copy',
                computeStartBeat,
            })
        ).toBe(false);

        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('duplicates MIDI ownership only after the clip add succeeds', () => {
        const source = {
            id: 'c1',
            trackId: 't1',
            name: 'MIDI take',
            startBeat: 0,
            endBeat: 4,
            type: 'midi' as const,
        };
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [source] }] });
        mocks.addClip.mockReturnValueOnce(null).mockReturnValueOnce({ id: 'c2', type: 'midi' });

        expect(duplicateClipCore({ clipId: 'c1', computeStartBeat: () => 4 })).toBe(false);
        expect(mocks.duplicateClipNotes).not.toHaveBeenCalled();

        expect(duplicateClipCore({ clipId: 'c1', computeStartBeat: () => 4 })).toBe(true);
        expect(mocks.duplicateClipNotes).toHaveBeenCalledWith('c1', 'c2');
    });
});
