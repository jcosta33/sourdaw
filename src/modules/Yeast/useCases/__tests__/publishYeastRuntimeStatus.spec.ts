import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    yeastStore: { value: null as { runtimeStatus: string; runtimeError?: string } | null, set: vi.fn() },
    getYeastRuntimeStatus: vi.fn(),
    getYeastRuntimeError: vi.fn(),
}));

vi.mock('../../stores/yeastStore', () => ({
    yeastStore: mocks.yeastStore,
}));

vi.mock('../../engine/yeastRuntime', () => ({
    getYeastRuntimeStatus: mocks.getYeastRuntimeStatus,
    getYeastRuntimeError: mocks.getYeastRuntimeError,
}));

import { publishYeastRuntimeStatus } from '../publishYeastRuntimeStatus';

describe('publishYeastRuntimeStatus', () => {
    it('is a no-op when store is null', () => {
        mocks.yeastStore.value = null;

        publishYeastRuntimeStatus();

        expect(mocks.yeastStore.set).not.toHaveBeenCalled();
    });

    it('is a no-op when status and error are unchanged', () => {
        mocks.yeastStore.value = { runtimeStatus: 'ready' };
        mocks.getYeastRuntimeStatus.mockReturnValue('ready');
        mocks.getYeastRuntimeError.mockReturnValue(null);

        publishYeastRuntimeStatus();

        expect(mocks.yeastStore.set).not.toHaveBeenCalled();
    });

    it('updates store when runtime status changed', () => {
        mocks.yeastStore.value = { runtimeStatus: 'initializing' };
        mocks.getYeastRuntimeStatus.mockReturnValue('ready');
        mocks.getYeastRuntimeError.mockReturnValue(null);

        publishYeastRuntimeStatus();

        expect(mocks.yeastStore.set).toHaveBeenCalledWith(
            expect.objectContaining({ runtimeStatus: 'ready' })
        );
    });

    it('sets runtimeError when present', () => {
        mocks.yeastStore.value = { runtimeStatus: 'ready' };
        mocks.getYeastRuntimeStatus.mockReturnValue('unavailable');
        mocks.getYeastRuntimeError.mockReturnValue('WASM load failed');

        publishYeastRuntimeStatus();

        const nextState = mocks.yeastStore.set.mock.calls[0]?.[0];
        expect(nextState.runtimeError).toBe('WASM load failed');
    });

    it('deletes runtimeError when absent', () => {
        mocks.yeastStore.value = { runtimeStatus: 'initializing', runtimeError: 'old error' };
        mocks.getYeastRuntimeStatus.mockReturnValue('ready');
        mocks.getYeastRuntimeError.mockReturnValue(null);

        publishYeastRuntimeStatus();

        const nextState = mocks.yeastStore.set.mock.calls[0]?.[0];
        expect('runtimeError' in nextState).toBe(false);
    });

    it('updates when only the error changed (status same)', () => {
        mocks.yeastStore.value = { runtimeStatus: 'ready' };
        mocks.getYeastRuntimeStatus.mockReturnValue('ready');
        mocks.getYeastRuntimeError.mockReturnValue('new error');

        publishYeastRuntimeStatus();

        expect(mocks.yeastStore.set).toHaveBeenCalled();
        const nextState = mocks.yeastStore.set.mock.calls[0]?.[0];
        expect(nextState.runtimeError).toBe('new error');
    });
});
