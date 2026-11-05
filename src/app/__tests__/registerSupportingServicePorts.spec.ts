/**
 * The supporting service ports answer exactly what the supporting module
 * answers, and no port answers anything before the composition root
 * registers it.
 *
 * Every case loads a fresh module graph, because each port holds its
 * registration in module state for the life of the realm.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadFreshModules() {
    vi.resetModules();
    const [arrangement, collaboration, collaborationStores, app] = await Promise.all([
        import('#/modules/Arrangement/useCases'),
        import('#/modules/Collaboration/useCases'),
        import('#/modules/Collaboration/stores'),
        import('../registerSupportingServicePorts'),
    ]);
    return { arrangement, collaboration, collaborationStores, app };
}

type FreshModules = Awaited<ReturnType<typeof loadFreshModules>>;

let modules: FreshModules;

// The first load transforms many whole module barrels, which can outlast the
// default hook timeout on a cold cache; each later fresh load reuses that work.
const WARM_UP_TIMEOUT_MS = 60_000;

beforeAll(async () => {
    await loadFreshModules();
}, WARM_UP_TIMEOUT_MS);

beforeEach(async () => {
    modules = await loadFreshModules();
});

describe('registerSupportingServicePorts before registration', () => {
    it('refuses every port read and names the function that registers it', () => {
        const { arrangement } = modules;
        const reads: [string, () => unknown][] = [
            ['transferCaller', () => arrangement.collaborationAssetTransfer.read('transferCaller')],
        ];

        for (const [caller, read] of reads) {
            expect(read).toThrow(
                new RegExp(
                    `^${caller}: .*registerSupportingServicePorts\\(\\) from #/app/registerSupportingServicePorts`
                )
            );
        }
    });
});

describe('registerSupportingServicePorts after registration', () => {
    beforeEach(() => {
        modules.app.registerSupportingServicePorts();
    });

    it("hands imports and playback Collaboration's own asset runtime", () => {
        const { arrangement, collaboration } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');

        expect(transfer.current).toBe(collaboration.getAssetTransfer);
    });

    it('reports a session only while Collaboration has one enabled', () => {
        const { arrangement, collaborationStores } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');
        const idle = collaborationStores.collaborationStore.value;
        if (!idle) {
            throw new Error('the collaboration store starts with its initial state');
        }

        expect(transfer.isSessionActive()).toBe(false);
        collaborationStores.collaborationStore.set({ ...idle, isEnabled: true });
        expect(transfer.isSessionActive()).toBe(true);
        collaborationStores.collaborationStore.set(null);
        expect(transfer.isSessionActive()).toBe(false);
    });

    it('treats a repeated registration as a no-op', () => {
        const { arrangement, app } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');

        expect(() => app.registerSupportingServicePorts()).not.toThrow();

        expect(arrangement.collaborationAssetTransfer.read('spec')).toBe(transfer);
    });

    it('refuses a registration that differs from the registered one', () => {
        const { arrangement } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');

        expect(() =>
            arrangement.collaborationAssetTransfer.configure({ ...transfer, isSessionActive: () => true })
        ).toThrow(/collaborationAssetTransfer\.configure: .*differs/);

        expect(arrangement.collaborationAssetTransfer.read('spec')).toBe(transfer);
    });
});
