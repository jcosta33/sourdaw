import { describe, expect, it, vi } from 'vitest';

import { resolveNativeNoteSink } from '../resolveNativeNoteSink';

import type { Track } from '#/modules/Arrangement/stores';

function make_track(devices: Array<{ id: string; type: string; externalInstanceId?: string }>): Track {
    return { id: 'track-x', devices } as unknown as Track;
}

describe('resolveNativeNoteSink', () => {
    it('returns null for a carried device that holds no hosted identity', () => {
        const track = make_track([{ id: 'ferm-1', type: 'fermenter' }]);

        const result = resolveNativeNoteSink(track, () => true);

        expect(result).toBeNull();
    });

    it('skips a hosted device the session does not carry and takes the next carried one', () => {
        const track = make_track([
            { id: 'plug-1', type: 'plugin', externalInstanceId: 'a' },
            { id: 'plug-2', type: 'plugin', externalInstanceId: 'b' },
        ]);

        const result = resolveNativeNoteSink(track, (_trackId, deviceId) => deviceId === 'plug-2');

        expect(result?.id).toBe('plug-2');
    });

    it('hands the predicate the instrument track id', () => {
        const track = {
            id: 'track-x',
            devices: [{ id: 'plug-1', type: 'plugin', externalInstanceId: 'a' }],
        } as unknown as Track;
        const isCarried = vi.fn(() => true);

        resolveNativeNoteSink(track, isCarried);

        expect(isCarried.mock.calls[0]).toEqual(['track-x', 'plug-1']);
    });
});
