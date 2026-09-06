import { describe, expect, it, vi } from 'vitest';

import { resolveNativeNoteSink } from '../resolveNativeNoteSink';

import type { Track } from '#/modules/Arrangement/stores';

function make_track(devices: Array<{ id: string; type: string; externalInstanceId?: string }>): Track {
    return { id: 'track-x', devices } as unknown as Track;
}

/** The real predicate is proven in nativeBuiltinBodies.spec; fermenter stands in for it here. */
const deps = (isCarried: (trackId: string, deviceId: string) => boolean) => ({
    isDeviceCarriedByNativeSession: isCarried,
    soundsNativeNotes: (type: string) => type === 'fermenter',
});

describe('resolveNativeNoteSink', () => {
    it('takes a carried built-in instrument as the sink', () => {
        const track = make_track([{ id: 'ferm-1', type: 'fermenter' }]);

        const result = resolveNativeNoteSink(
            track,
            deps(() => true)
        );

        expect(result?.id).toBe('ferm-1');
    });

    it('returns null for a carried built-in effect', () => {
        const track = make_track([{ id: 'knead-1', type: 'knead' }]);

        const result = resolveNativeNoteSink(
            track,
            deps(() => true)
        );

        expect(result).toBeNull();
    });

    it('skips a hosted device the session does not carry and takes the next carried one', () => {
        const track = make_track([
            { id: 'plug-1', type: 'plugin', externalInstanceId: 'a' },
            { id: 'plug-2', type: 'plugin', externalInstanceId: 'b' },
        ]);

        const result = resolveNativeNoteSink(
            track,
            deps((_trackId, deviceId) => deviceId === 'plug-2')
        );

        expect(result?.id).toBe('plug-2');
    });

    it('takes the first carried sink in chain order across hosted and built-in', () => {
        const fermenterFirst = make_track([
            { id: 'ferm-1', type: 'fermenter' },
            { id: 'plug-1', type: 'plugin', externalInstanceId: 'a' },
        ]);
        const hostedFirst = make_track([
            { id: 'plug-1', type: 'plugin', externalInstanceId: 'a' },
            { id: 'ferm-1', type: 'fermenter' },
        ]);

        expect(
            resolveNativeNoteSink(
                fermenterFirst,
                deps(() => true)
            )?.id
        ).toBe('ferm-1');
        expect(
            resolveNativeNoteSink(
                hostedFirst,
                deps(() => true)
            )?.id
        ).toBe('plug-1');
    });

    it('hands the predicate the instrument track id', () => {
        const track = {
            id: 'track-x',
            devices: [{ id: 'plug-1', type: 'plugin', externalInstanceId: 'a' }],
        } as unknown as Track;
        const isCarried = vi.fn(() => true);

        resolveNativeNoteSink(track, deps(isCarried));

        expect(isCarried.mock.calls[0]).toEqual(['track-x', 'plug-1']);
    });
});
