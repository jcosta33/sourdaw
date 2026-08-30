import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { initPluginStateDirtyTracking } from '../initPluginStateDirtyTracking';

type ParameterEdit = {
    instanceId: string;
    parameterId: number;
    kind: 'gestureBegin' | 'value' | 'gestureEnd';
    value?: number;
};

const mocks = vi.hoisted(() => ({
    watchPluginStateDirty: vi.fn<(onChanged: () => void) => Promise<() => void>>(),
    observeExternalPluginParameterEdits: vi.fn<(observer: (edit: unknown) => void) => () => void>(),
    warn: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    watchPluginStateDirty: mocks.watchPluginStateDirty,
    observeExternalPluginParameterEdits: mocks.observeExternalPluginParameterEdits,
}));
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
    let reportParameterEdit: ((edit: ParameterEdit) => void) | null = null;
    let unlisten: ReturnType<typeof vi.fn<() => void>>;
    let stopObserving: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        vi.clearAllMocks();
        unlisten = vi.fn<() => void>();
        stopObserving = vi.fn<() => void>();
        mocks.watchPluginStateDirty.mockImplementation((onChanged) => {
            reportStateChanged = onChanged;
            return Promise.resolve(unlisten);
        });
        mocks.observeExternalPluginParameterEdits.mockImplementation((observer) => {
            reportParameterEdit = observer;
            return stopObserving;
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

    /**
     * A plugin that reports the parameter it changed need never declare its
     * whole state dirty, so a project watching only `plugin-state-dirty` closes
     * clean over a knob ride the user watched happen.
     */
    it('marks the open project dirty when a plugin reports a parameter it changed', () => {
        expect(projectStore.value?.dirty).toBe(false);

        reportParameterEdit?.({ instanceId: 'inst-1', parameterId: 12, kind: 'value', value: 0.75 });

        expect(projectStore.value?.dirty).toBe(true);
    });

    /**
     * Taking hold of a control is not an edit. Marking dirty on a boundary would
     * have a project ask to be saved over a knob that was touched and released
     * at the same setting.
     */
    it('leaves the project clean for a gesture boundary that changed nothing', () => {
        reportParameterEdit?.({ instanceId: 'inst-1', parameterId: 12, kind: 'gestureBegin' });
        reportParameterEdit?.({ instanceId: 'inst-1', parameterId: 12, kind: 'gestureEnd' });

        expect(projectStore.value?.dirty).toBe(false);
    });

    it('leaves a project that is still loading clean when a plugin reports a parameter', () => {
        projectStore.set({ ...projectStore.value!, loading: true, dirty: false });

        reportParameterEdit?.({ instanceId: 'inst-1', parameterId: 12, kind: 'value', value: 0.75 });

        expect(projectStore.value?.dirty).toBe(false);
    });

    it('stops listening when the tracking is torn down', async () => {
        unsubscribe?.();
        unsubscribe = undefined;
        await mocks.watchPluginStateDirty.mock.results[0]?.value;

        expect(unlisten).toHaveBeenCalled();
        expect(stopObserving).toHaveBeenCalled();
    });
});
