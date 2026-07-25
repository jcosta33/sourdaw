import { beforeEach, describe, expect, it, vi } from 'vitest';

const crumbs_all_sound_off = vi.hoisted(() => vi.fn<(instanceId: string) => Promise<void>>(() => Promise.resolve()));

vi.mock('../../repositories/crumbsBridge/crumbsAllSoundOff', () => ({
    crumbsAllSoundOff: crumbs_all_sound_off,
}));

const { panicCrumbs } = await import('../panicCrumbs');
const { crumbsStore, defaultCrumbsState } = await import('../../stores/crumbsStore');

describe('panicCrumbs', () => {
    beforeEach(() => {
        crumbs_all_sound_off.mockClear();
        crumbsStore.set({});
    });

    // audit MD-6 — Crumbs voices live in the native engine, outside the Web
    // Audio graph the engine-wide stop sweep walks, so a pad triggered from the
    // panel and never released survives every other release path.
    it('silences every live instance', async () => {
        crumbsStore.set({ 'crumbs-a': defaultCrumbsState, 'crumbs-b': defaultCrumbsState });

        await panicCrumbs();

        expect(crumbs_all_sound_off.mock.calls.map(([id]) => id).sort()).toEqual(['crumbs-a', 'crumbs-b']);
    });

    it('does nothing when no instance is live', async () => {
        await panicCrumbs();

        expect(crumbs_all_sound_off).not.toHaveBeenCalled();
    });
});
