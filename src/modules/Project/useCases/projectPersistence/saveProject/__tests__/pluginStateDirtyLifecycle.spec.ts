import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { initPluginStateDirtyTracking } from '../initPluginStateDirtyTracking';

const mocks = vi.hoisted(() => ({
    watchPluginStateDirty: vi.fn<(onChanged: () => void) => Promise<() => void>>(),
    warn: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({ watchPluginStateDirty: mocks.watchPluginStateDirty }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));

/**
 * An edit made inside a hosted plugin's own editor never passes through this
 * app: no store changes, so the arrangement subscription that carries every
 * other edit sees nothing. The work is real and it is saved with the project, so
 * without this the project closes clean over edits the user watched happen.
 */
describe('plugin state project dirty lifecycle', () => {
    let unsubscribe: (() => void) | undefined;
    let reportStateChanged: (() => void) | null = null;
    let unlisten: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        vi.clearAllMocks();
        unlisten = vi.fn<() => void>();
        mocks.watchPluginStateDirty.mockImplementation((onChanged) => {
            reportStateChanged = onChanged;
            return Promise.resolve(unlisten);
        });
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        unsubscribe = initPluginStateDirtyTracking();
    });

    afterEach(() => unsubscribe?.());

    it('marks the open project dirty when a plugin reports its state changed', () => {
        expect(projectStore.value?.dirty).toBe(false);

        reportStateChanged?.();

        expect(projectStore.value?.dirty).toBe(true);
    });

    /**
     * A project being loaded is not being edited, and restoring a plugin's
     * persisted state chunk is exactly what makes it report a change. Marking
     * dirty there would leave every freshly opened project claiming unsaved
     * work.
     */
    it('leaves a project that is still loading clean', () => {
        projectStore.set({ ...projectStore.value!, loading: true, dirty: false });

        reportStateChanged?.();

        expect(projectStore.value?.dirty).toBe(false);
    });

    it('stops listening when the tracking is torn down', async () => {
        unsubscribe?.();
        unsubscribe = undefined;
        await mocks.watchPluginStateDirty.mock.results[0]?.value;

        expect(unlisten).toHaveBeenCalled();
    });
});
