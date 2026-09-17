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

    it('returns null for a built-in instrument on a strip the session does not carry', () => {
        const track = make_track([{ id: 'ferm-1', type: 'fermenter' }]);

        const result = resolveNativeNoteSink(
            track,
            deps(() => false)
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

    // Crumbs takes live notes through the engine's own note store, registered
    // when the instance is spliced in. Carriage is the proof it was: the
    // carrier law refuses to carry a strip holding a Crumbs device the engine
    // does not hold. `soundsNativeNotes` answers false for it — the engine
    // builds no Crumbs body — so a rule reading only that dropped every live
    // note a musician played into a carried sampler.
    it('takes a carried Crumbs device as the sink', () => {
        const track = make_track([{ id: 'crumbs-1', type: 'builtin-crumbs' }]);

        const result = resolveNativeNoteSink(
            track,
            deps(() => true)
        );

        expect(result?.id).toBe('crumbs-1');
    });

    it('returns null for a Crumbs device on a strip the session does not carry', () => {
        const track = make_track([{ id: 'crumbs-1', type: 'builtin-crumbs' }]);

        const result = resolveNativeNoteSink(
            track,
            deps(() => false)
        );

        expect(result).toBeNull();
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
