import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { restoreTrackAtIndex } from '../restoreTrackAtIndex';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
}));

vi.mock('../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));

describe('restoreTrackAtIndex', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores the canonical track snapshot at its captured index', () => {
        const sourceTrack = createTrack({ id: 'source-track', name: 'Source', kind: 'midi' });
        const tailTrack = createTrack({ id: 'tail-track', name: 'Tail', kind: 'audio' });
        const generatedTrack = createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' });
        generatedTrack.color = '#123456';
        generatedTrack.devices[0]!.id = 'stable-device';
        generatedTrack.activeAlternativeId = 'stable-alternative';
        generatedTrack.alternatives = [{ id: 'stable-alternative', name: 'Alternative 1', clips: [] }];
        generatedTrack.clips = [
            {
                id: 'generated-clip',
                trackId: generatedTrack.id,
                name: 'Bassline',
                startBeat: 0,
                endBeat: 4,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            },
        ];
        const trackJson = JSON.stringify(generatedTrack);
        mocks.getTrackState.mockReturnValue({
            tracks: [sourceTrack, tailTrack],
            selectedTrackId: sourceTrack.id,
            ghostClips: [],
        });

        const result = restoreTrackAtIndex({ trackJson, trackIndex: 1 });

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [sourceTrack, generatedTrack, tailTrack],
            selectedTrackId: sourceTrack.id,
            ghostClips: [],
        });
        if (!result) {
            throw new Error('Expected exact track restoration');
        }
        expect(result.devices[0]?.id).toBe('stable-device');
        expect(result.activeAlternativeId).toBe('stable-alternative');
    });

    it('rejects a non-canonical partial snapshot before writing', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null, ghostClips: [] });
        const trackJson = JSON.stringify({ id: 'generated-track', name: 'Bass', kind: 'midi', clips: [] });

        expect(restoreTrackAtIndex({ trackJson, trackIndex: 0 })).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('rejects device and ghost-clip identity collisions before writing', () => {
        const generatedTrack = createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' });
        generatedTrack.devices[0]!.id = 'stable-device';
        generatedTrack.clips = [
            {
                id: 'generated-clip',
                trackId: generatedTrack.id,
                name: 'Bassline',
                startBeat: 0,
                endBeat: 4,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            },
        ];
        const trackJson = JSON.stringify(generatedTrack);
        const foreignTrack = createTrack({ id: 'foreign-track', name: 'Foreign', kind: 'midi' });
        foreignTrack.devices[0]!.id = 'stable-device';
        mocks.getTrackState.mockReturnValue({
            tracks: [foreignTrack],
            selectedTrackId: null,
            ghostClips: [],
        });

        expect(restoreTrackAtIndex({ trackJson, trackIndex: 1 })).toBeNull();

        foreignTrack.devices[0]!.id = 'foreign-device';
        mocks.getTrackState.mockReturnValue({
            tracks: [foreignTrack],
            selectedTrackId: null,
            ghostClips: [{ ...generatedTrack.clips[0]!, trackId: foreignTrack.id }],
        });

        expect(restoreTrackAtIndex({ trackJson, trackIndex: 1 })).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
