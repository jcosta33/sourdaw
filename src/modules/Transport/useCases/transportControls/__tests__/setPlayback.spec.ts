import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { pausePlayback } from '../pausePlayback';
import { setPlayback } from '../setPlayback';
import { startPlayback } from '../startPlayback';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../pausePlayback', () => ({ pausePlayback: vi.fn() }));
vi.mock('../startPlayback', () => ({ startPlayback: vi.fn() }));

describe('setPlayback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts playback only when the desired state is playing', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false });

        setPlayback(true);

        expect(startPlayback).toHaveBeenCalledOnce();
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('pauses playback only when the desired state is paused', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });

        setPlayback(false);

        expect(pausePlayback).toHaveBeenCalledOnce();
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it.each([true, false])('does not toggle when playback already equals %s', (playing) => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: playing });

        setPlayback(playing);

        expect(startPlayback).not.toHaveBeenCalled();
        expect(pausePlayback).not.toHaveBeenCalled();
    });

    it('does nothing when transport state is unavailable', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        setPlayback(true);

        expect(startPlayback).not.toHaveBeenCalled();
        expect(pausePlayback).not.toHaveBeenCalled();
    });
});
