import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '../../models/Track';
import { rearmInputMonitoring } from '../rearmInputMonitoring';

type MonitorTrack = Pick<Track, 'id' | 'inputMonitoring' | 'inputId'>;

const mocks = vi.hoisted(() => ({
    startInputMonitoring: vi.fn(() => Promise.resolve(true)),
    reconcileAutoInputMonitoring: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    startInputMonitoring: mocks.startInputMonitoring,
    reconcileAutoInputMonitoring: mocks.reconcileAutoInputMonitoring,
}));

function track(
    id: string,
    inputMonitoring: MonitorTrack['inputMonitoring'],
    inputId: string | null = null
): MonitorTrack {
    return { id, inputMonitoring, inputId };
}

describe('rearmInputMonitoring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.startInputMonitoring.mockResolvedValue(true);
    });

    it('re-arms a track whose persisted intent is on, with its inputId', async () => {
        await rearmInputMonitoring([track('t1', 'on', 'in-1')]);

        expect(mocks.startInputMonitoring).toHaveBeenCalledOnce();
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'in-1');
    });

    it('does not re-arm tracks whose persisted intent is off or auto', async () => {
        await rearmInputMonitoring([track('t-off', 'off', 'in-off'), track('t-auto', 'auto', 'in-auto')]);

        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('re-arms every on track and ignores the rest', async () => {
        await rearmInputMonitoring([
            track('t1', 'on', 'in-1'),
            track('t2', 'off', 'in-2'),
            track('t3', 'on', 'in-3'),
            track('t4', 'auto', 'in-4'),
        ]);

        expect(mocks.startInputMonitoring).toHaveBeenCalledTimes(2);
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'in-1');
        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t3', 'in-3');
    });

    it('reconciles Auto tracks through their owner instead of starting them itself', async () => {
        await rearmInputMonitoring([track('t4', 'auto', 'in-4')]);

        expect(mocks.reconcileAutoInputMonitoring).toHaveBeenCalledTimes(1);
        expect(mocks.startInputMonitoring).not.toHaveBeenCalled();
    });

    it('settles a refusal without rejecting', async () => {
        mocks.startInputMonitoring.mockRejectedValueOnce(new Error('microphone refused'));

        await expect(rearmInputMonitoring([track('t1', 'on', 'in-1')])).resolves.toBeUndefined();

        expect(mocks.startInputMonitoring).toHaveBeenCalledWith('t1', 'in-1');
    });
});
