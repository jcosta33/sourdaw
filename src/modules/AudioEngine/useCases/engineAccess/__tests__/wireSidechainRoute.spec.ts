import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { refreshSidechainAlignment } from '../refreshSidechainAlignment';
import { wireSidechainRoute } from '../wireSidechainRoute';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        wireSidechainRoute: vi.fn(),
        refreshSidechainAlignment: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));

describe('wireSidechainRoute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the route to the engine', () => {
        wireSidechainRoute('kick', 'bass', 'dev-sc');

        expect(audioEngine.wireSidechainRoute).toHaveBeenCalledWith('kick', 'bass', 'dev-sc');
    });

    // FX-5 — a freshly wired route's alignment line starts at zero; without this
    // the key stays un-aligned until the transport starts ticking.
    it('resolves the key alignment immediately after wiring, in that order', () => {
        wireSidechainRoute('kick', 'bass', 'dev-sc');

        expect(audioEngine.refreshSidechainAlignment).toHaveBeenCalledTimes(1);
        expect(vi.mocked(audioEngine.wireSidechainRoute).mock.invocationCallOrder[0]!).toBeLessThan(
            vi.mocked(audioEngine.refreshSidechainAlignment).mock.invocationCallOrder[0]!
        );
    });
});

describe('refreshSidechainAlignment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hands the engine a resolver that recomputes from project state on each call', () => {
        refreshSidechainAlignment();

        const [resolver] = vi.mocked(audioEngine.refreshSidechainAlignment).mock.calls[0]!;
        // With no project loaded there is nothing to align; the point is that the
        // engine is handed a live resolver rather than a snapshot value.
        expect(resolver({ sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'dev-sc' })).toBe(0);
    });
});
