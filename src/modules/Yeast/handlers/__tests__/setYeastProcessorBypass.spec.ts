import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setActiveYeastDevice, type YeastState } from '../../stores/yeastStore';
import { handleSetYeastProcessorBypass } from '../setYeastProcessorBypass';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as YeastState | null },
    bypassUseCase: vi.fn(),
}));
vi.mock('../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: vi.fn((state: YeastState) => {
            mocks.storeValue.value = state;
        }),
    },
    setActiveYeastDevice: vi.fn(),
}));
vi.mock('../../useCases/setYeastProcessorBypass', () => ({
    setYeastProcessorBypass: mocks.bypassUseCase,
}));

function seedRack(bypassed: boolean): void {
    mocks.storeValue.value = {
        processors: [{ id: 'filter-1', type: 'filter', name: 'Filter', bypassed, params: {} }],
        uiLevel: 3,
    };
}

describe('handleSetYeastProcessorBypass', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setActiveYeastDevice(null);
    });

    it('writes when expectedBypassed matches and routes through the use case', () => {
        seedRack(false);

        const result = handleSetYeastProcessorBypass.execute({
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.bypassUseCase).toHaveBeenCalledWith('filter-1', true);
    });

    it('refuses with nothing written when the live flag diverged', () => {
        seedRack(true);

        const result = handleSetYeastProcessorBypass.execute({
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: false, expectedBypassed: false },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.bypassUseCase).not.toHaveBeenCalled();
    });

    it('refuses when the processor vanished', () => {
        seedRack(false);
        mocks.storeValue.value!.processors = [];

        const result = handleSetYeastProcessorBypass.execute({
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('is a noop when the live flag already equals the request', () => {
        seedRack(true);

        expect(
            handleSetYeastProcessorBypass.isNoop?.({
                type: 'setYeastProcessorBypass',
                payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
            })
        ).toBe(true);
    });

    it('describes a self-inverse returning the pre-gesture flag', () => {
        seedRack(false);

        const described = handleSetYeastProcessorBypass.describe({
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
        });

        expect(described.inverseAction).toEqual({
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: false, expectedBypassed: true },
        });
        expect(described.redoAction).toEqual({
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
        });
    });

    it('validates against a prior same-processor sibling in the batch', () => {
        seedRack(false);
        const context = {
            actions: [
                {
                    type: 'setYeastProcessorBypass' as const,
                    payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
                },
            ],
            actionIndex: 1,
        };

        expect(
            handleSetYeastProcessorBypass.validate!(
                {
                    type: 'setYeastProcessorBypass',
                    payload: { processorId: 'filter-1', bypassed: false, expectedBypassed: true },
                },
                context
            )
        ).toBe(true);
        expect(
            handleSetYeastProcessorBypass.validate!(
                {
                    type: 'setYeastProcessorBypass',
                    payload: { processorId: 'filter-1', bypassed: false, expectedBypassed: false },
                },
                context
            )
        ).toBe(false);
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleSetYeastProcessorBypass.undoable).toBe(true);
        expect(handleSetYeastProcessorBypass.canReportConflict).toBe(true);
    });
});
