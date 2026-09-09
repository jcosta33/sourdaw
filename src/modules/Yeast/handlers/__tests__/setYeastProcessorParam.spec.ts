import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type YeastState } from '../../stores/yeastStore';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as YeastState | null },
    setParamUseCase: vi.fn(() => Promise.resolve()),
    setGrooveTemplateUseCase: vi.fn(() => Promise.resolve()),
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
}));

vi.mock('../../useCases/setYeastProcessorParam', () => ({
    GROOVE_AMOUNT_PARAM: 'amount',
    setYeastProcessorParam: mocks.setParamUseCase,
}));

vi.mock('../../useCases/setYeastGrooveTemplate', () => ({
    setYeastGrooveTemplate: mocks.setGrooveTemplateUseCase,
}));

import { handleSetYeastProcessorParam } from '../setYeastProcessorParam';

function seedRack(state: YeastState | null): void {
    mocks.storeValue.value = state;
}

function rackWith(processors: YeastState['processors']): YeastState {
    return { processors, uiLevel: 3 };
}

function filterProcessor(): YeastState['processors'][number] {
    return { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: { gate: 0.8 } };
}

describe('handleSetYeastProcessorParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes a fresh request and routes it through the use case', async () => {
        seedRack(rackWith([filterProcessor()]));

        const result = await handleSetYeastProcessorParam.execute({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.setParamUseCase).toHaveBeenCalledWith('filter-1', 'gate', 1.2);
    });

    it('writes when expectedValue still matches the live value', async () => {
        seedRack(rackWith([filterProcessor()]));

        const result = await handleSetYeastProcessorParam.execute({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2, expectedValue: 0.8 },
        });

        expect(result).toEqual({ status: 'written' });
    });

    it('refuses with nothing written when expectedValue diverged', async () => {
        seedRack(rackWith([filterProcessor()]));

        const result = await handleSetYeastProcessorParam.execute({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2, expectedValue: 0.5 },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setParamUseCase).not.toHaveBeenCalled();
        expect(mocks.storeValue.value?.processors[0]?.params?.gate).toBe(0.8);
    });

    it('refuses when the processor vanished', async () => {
        seedRack(rackWith([]));

        const result = await handleSetYeastProcessorParam.execute({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2 },
        });

        expect(result).toEqual({ status: 'conflict' });
    });

    it('delegates the groove amount to no-write without touching any use case', async () => {
        seedRack(
            rackWith([{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: { amount: 0.5 } }])
        );

        const result = await handleSetYeastProcessorParam.execute({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'groove-1', paramId: 'amount', value: 0.9, expectedValue: 0.5 },
        });
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setParamUseCase).not.toHaveBeenCalled();
        expect(mocks.setGrooveTemplateUseCase).not.toHaveBeenCalled();
        expect(mocks.storeValue.value?.processors[0]?.params?.amount).toBe(0.5);
    });

    it('is a noop when the live value already equals the request', () => {
        seedRack(rackWith([filterProcessor()]));

        expect(
            handleSetYeastProcessorParam.isNoop?.({
                type: 'setYeastProcessorParam',
                payload: { processorId: 'filter-1', paramId: 'gate', value: 0.8 },
            })
        ).toBe(true);
        expect(
            handleSetYeastProcessorParam.isNoop?.({
                type: 'setYeastProcessorParam',
                payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2 },
            })
        ).toBe(false);
    });

    it('describes an inverse/redo pair that returns the pre-gesture value', () => {
        seedRack(rackWith([filterProcessor()]));

        const described = handleSetYeastProcessorParam.describe({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2, expectedValue: 0.8 },
        });

        expect(described.label).toBe('Set Yeast parameter');
        expect(described.inverseAction).toEqual({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 0.8, expectedValue: 1.2 },
        });
        expect(described.redoAction).toEqual({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2, expectedValue: 0.8 },
        });
    });

    it('validates against a prior same-key sibling in the batch', () => {
        seedRack(rackWith([filterProcessor()]));
        const context = {
            actions: [
                { type: 'setYeastProcessorParam' as const, payload: { processorId: 'filter-1', paramId: 'gate', value: 1.2 } },
            ],
            actionIndex: 1,
        };

        // Live gate is 0.8, but the prior sibling writes 1.2 first — the guard
        // must read the projected value, not the live one.
        expect(
            handleSetYeastProcessorParam.validate!(
                { type: 'setYeastProcessorParam', payload: { processorId: 'filter-1', paramId: 'gate', value: 0.4, expectedValue: 1.2 } },
                context
            )
        ).toBe(true);
        expect(
            handleSetYeastProcessorParam.validate!(
                { type: 'setYeastProcessorParam', payload: { processorId: 'filter-1', paramId: 'gate', value: 0.4, expectedValue: 0.8 } },
                context
            )
        ).toBe(false);
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleSetYeastProcessorParam.undoable).toBe(true);
        expect(handleSetYeastProcessorParam.canReportConflict).toBe(true);
    });
});
