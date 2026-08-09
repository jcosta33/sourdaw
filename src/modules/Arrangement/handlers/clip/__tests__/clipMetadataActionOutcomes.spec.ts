import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleLockClip } from '../handleLockClip';
import { handleMuteClip } from '../handleMuteClip';
import { handleRenameClip } from '../handleRenameClip';
import { handleSetClipColor } from '../handleSetClipColor';
import { handleSetClipFade } from '../handleSetClipFade';
import { handleSetClipGain } from '../handleSetClipGain';
import { handleSetClipLoop } from '../handleSetClipLoop';
import { handleSetClipLoopLength } from '../handleSetClipLoopLength';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('../../../repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

const metadataActions = [
    {
        name: 'lockClip',
        execute: () =>
            handleLockClip.execute({
                type: 'lockClip',
                payload: { clipId: 'clip-1', locked: true },
            }),
    },
    {
        name: 'muteClip',
        execute: () =>
            handleMuteClip.execute({
                type: 'muteClip',
                payload: { clipId: 'clip-1', muted: true },
            }),
    },
    {
        name: 'renameClip',
        execute: () =>
            handleRenameClip.execute({
                type: 'renameClip',
                payload: { clipId: 'clip-1', name: 'Renamed clip' },
            }),
    },
    {
        name: 'setClipColor',
        execute: () =>
            handleSetClipColor.execute({
                type: 'setClipColor',
                payload: { clipId: 'clip-1', color: '#ff0000' },
            }),
    },
    {
        name: 'setClipFade',
        execute: () =>
            handleSetClipFade.execute({
                type: 'setClipFade',
                payload: { clipId: 'clip-1', fadeInBeats: 1, fadeOutBeats: 2 },
            }),
    },
    {
        name: 'setClipGain',
        execute: () =>
            handleSetClipGain.execute({
                type: 'setClipGain',
                payload: { clipId: 'clip-1', gain: 0.75 },
            }),
    },
    {
        name: 'setClipLoop',
        execute: () =>
            handleSetClipLoop.execute({
                type: 'setClipLoop',
                payload: { clipId: 'clip-1', enabled: true },
            }),
    },
    {
        name: 'setClipLoopLength',
        execute: () =>
            handleSetClipLoopLength.execute({
                type: 'setClipLoopLength',
                payload: { clipId: 'clip-1', loopLength: 4 },
            }),
    },
] as const;

describe('clip metadata action outcomes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set(defaultTransportState);
        const clip = ClipDummy.create({ id: 'clip-1', endBeat: 8 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    it.each(metadataActions)('$name reports no-write when the repository rejects the write', ({ execute }) => {
        mocks.updateClip.mockReturnValue(false);

        expect(execute()).toEqual({ status: 'no-write' });
        expect(mocks.updateClip).toHaveBeenCalledOnce();
    });

    it.each(metadataActions)('$name reports written when the repository commits the write', ({ execute }) => {
        mocks.updateClip.mockReturnValue(true);

        expect(execute()).toEqual({ status: 'written' });
        expect(mocks.updateClip).toHaveBeenCalledOnce();
    });

    it.each([0, -1])('setClipLoopLength reports no-write without a repository call for length %s', (loopLength) => {
        mocks.updateClip.mockReturnValue(true);

        const result = handleSetClipLoopLength.execute({
            type: 'setClipLoopLength',
            payload: { clipId: 'clip-1', loopLength },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.updateClip).not.toHaveBeenCalled();
    });
});
