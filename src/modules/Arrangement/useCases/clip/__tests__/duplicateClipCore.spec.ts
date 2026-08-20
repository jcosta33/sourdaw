import { describe, it, expect, vi, beforeEach } from 'vitest';

import { duplicateClipCore } from '../duplicateClipCore';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    getNextClipId: vi.fn(),
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

vi.mock('../../../repositories/clipIdCounter', () => ({
    getNextClipId: mocks.getNextClipId,
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

vi.mock('../../../stores/warpStates', async (importOriginal) => {
    // `isDefaultWarpState` is kept real (it's a pure comparison against
    // `defaultWarpState`, not a map read) so duplicateClipCore's own
    // write-skip guard is exercised for real rather than through a stub.
    const actual = await importOriginal<typeof import('../../../stores/warpStates')>();
    return {
        ...actual,
        getWarpState: mocks.getWarpState,
        setWarpState: mocks.setWarpState,
    };
});

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('duplicateClipCore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getNextClipId.mockReturnValue('c2');
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

        expect(mocks.getNextClipId).toHaveBeenCalledOnce();
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
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

    it('does not stamp a warpStates entry when the cloned warp state is value-identical to default', () => {
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
            enabled: false,
            markers: [],
            stretchMode: 'repitch',
            originalTempo: null,
        });

        duplicateClipCore({
            clipId: 'c1',
            computeStartBeat: (clip) => clip.endBeat,
        });

        expect(mocks.setWarpState).not.toHaveBeenCalled();
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

    it('rejects a generated target id collision before computing or publishing', () => {
        const computeStartBeat = vi.fn(() => 4);
        const source = {
            id: 'c1',
            trackId: 't1',
            name: 'Take',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
        };
        mocks.getNextClipId.mockReturnValue('clip-collision');
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            if (input.clipId === 'clip-collision') {
                return { status: 'eligible', clipId: 'clip-collision', trackId: 't1' };
            }
            return { status: 'missing' };
        });
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [source] }] });
        mocks.addClip.mockReturnValue({ id: 'clip-collision', type: 'audio' });

        expect(duplicateClipCore({ clipId: 'c1', computeStartBeat })).toBe(false);

        expect(mocks.getNextClipId).toHaveBeenCalledOnce();
        expect(mocks.resolveEligibleClipWriteTarget).toHaveBeenCalledWith({ clipId: 'clip-collision' });
        expect(mocks.getTrackState).not.toHaveBeenCalled();
        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.duplicateClipAutomation).not.toHaveBeenCalled();
        expect(mocks.getWarpState).not.toHaveBeenCalled();
        expect(mocks.setWarpState).not.toHaveBeenCalled();
        expect(mocks.duplicateClipNotes).not.toHaveBeenCalled();
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

    describe('legacy string overload', () => {
        it('accepts (clipId, computeStartBeat) and resolves source by clipId string', () => {
            const source = {
                id: 'c1',
                trackId: 't1',
                name: 'Take',
                startBeat: 0,
                endBeat: 4,
                type: 'audio' as const,
                fadeInBeats: 0,
                fadeOutBeats: 0,
            };
            mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [source] }] });
            mocks.addClip.mockReturnValue({ id: 'c2', type: 'audio' });

            expect(duplicateClipCore('c1', (clip) => clip.endBeat)).toBe(true);

            // targetClipId was undefined in legacy form, so id comes from counter
            expect(mocks.getNextClipId).toHaveBeenCalledOnce();
            expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2', startBeat: 4 }));
        });

        it('returns false when called with no computeStartBeat (missing 2nd arg)', () => {
            // The runtime overload accepts the legacy form without a 2nd arg; emulate a caller
            // that forgot to pass computeStartBeat.
            expect((duplicateClipCore as unknown as (clipId: string) => boolean)('c1')).toBe(false);
            expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
            expect(mocks.addClip).not.toHaveBeenCalled();
        });

        it('returns false when object form omits computeStartBeat', () => {
            // object form without computeStartBeat hits the same guard
            expect(duplicateClipCore({ clipId: 'c1' } as never)).toBe(false);
            expect(mocks.resolveEligibleClipWriteTarget).not.toHaveBeenCalled();
        });
    });

    it('aborts when destination track write is not eligible', () => {
        const computeStartBeat = vi.fn(() => 4);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            // destination lookup by trackId returns ineligible
            if (input.trackId === 't1') {
                return { status: 'ineligible' };
            }
            return { status: 'missing' };
        });

        expect(
            duplicateClipCore({
                clipId: 'c1',
                targetClipId: 'c2',
                computeStartBeat,
            })
        ).toBe(false);

        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('aborts when the generated target id is the empty string', () => {
        const computeStartBeat = vi.fn(() => 4);
        mocks.getNextClipId.mockReturnValue('');
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] });

        expect(
            duplicateClipCore({
                clipId: 'c1',
                computeStartBeat,
            })
        ).toBe(false);

        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('aborts when no track state is present', () => {
        const computeStartBeat = vi.fn(() => 4);
        mocks.getTrackState.mockReturnValue(null);

        expect(
            duplicateClipCore({
                clipId: 'c1',
                targetClipId: 'c2',
                computeStartBeat,
            })
        ).toBe(false);

        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('aborts when the source track no longer contains the clip', () => {
        const computeStartBeat = vi.fn(() => 4);
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] });

        expect(
            duplicateClipCore({
                clipId: 'c1',
                targetClipId: 'c2',
                computeStartBeat,
            })
        ).toBe(false);

        expect(computeStartBeat).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });
});
