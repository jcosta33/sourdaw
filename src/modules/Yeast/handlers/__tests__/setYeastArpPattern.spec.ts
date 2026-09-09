import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createDefaultPattern, defaultStep, type ArpStep } from '../../models/ArpPattern';
import { type YeastState } from '../../stores/yeastStore';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as YeastState | null },
    setPatternUseCase: vi.fn(() => Promise.resolve()),
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

vi.mock('../../useCases/setYeastArpPattern', () => ({
    setYeastArpPattern: mocks.setPatternUseCase,
}));

import { handleSetYeastArpPattern } from '../setYeastArpPattern';

function seedRack(state: YeastState | null): void {
    mocks.storeValue.value = state;
}

function arpProcessor(params: Record<string, number>): YeastState['processors'][number] {
    return { id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params };
}

function patternWithFirstVelocity(velocity: number): ArpStep[] {
    const steps = createDefaultPattern(8);
    steps[0] = { ...defaultStep(), velocity };
    return steps;
}

describe('handleSetYeastArpPattern', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes a fresh request through the use case', async () => {
        seedRack({ processors: [arpProcessor({})], uiLevel: 3 });
        const steps = patternWithFirstVelocity(64);

        const result = await handleSetYeastArpPattern.execute({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.setPatternUseCase).toHaveBeenCalledWith('arp-1', steps);
    });

    it('refuses with nothing written when the decoded pattern diverged', async () => {
        // Live decodes to the default 8-step pattern; the undo inverse expects
        // an edited one — same processor, different pattern_ subset.
        seedRack({ processors: [arpProcessor({})], uiLevel: 3 });

        const result = await handleSetYeastArpPattern.execute({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps: patternWithFirstVelocity(10), expectedSteps: patternWithFirstVelocity(99) },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setPatternUseCase).not.toHaveBeenCalled();
    });

    it('ignores non-pattern param edits when comparing the guard', async () => {
        // A peer edited a NON-pattern param of the same processor; the decoded
        // pattern subset is untouched, so the guard still matches.
        seedRack({ processors: [arpProcessor({ gate: 1.5 })], uiLevel: 3 });
        const steps = patternWithFirstVelocity(64);

        const result = await handleSetYeastArpPattern.execute({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps, expectedSteps: createDefaultPattern(8) },
        });

        expect(result).toEqual({ status: 'written' });
    });

    it('refuses when the processor vanished or is not an arpeggiator', async () => {
        seedRack({ processors: [], uiLevel: 3 });
        const vanished = await handleSetYeastArpPattern.execute({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps: patternWithFirstVelocity(64) },
        });
        expect(vanished).toEqual({ status: 'conflict' });

        seedRack({ processors: [{ id: 'arp-1', type: 'filter', name: 'F', bypassed: false, params: {} }], uiLevel: 3 });
        const notAnArp = await handleSetYeastArpPattern.execute({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps: patternWithFirstVelocity(64) },
        });
        expect(notAnArp).toEqual({ status: 'conflict' });
    });

    it('is a noop when the live pattern already decodes to the request', () => {
        seedRack({ processors: [arpProcessor({})], uiLevel: 3 });

        expect(
            handleSetYeastArpPattern.isNoop?.({
                type: 'setYeastArpPattern',
                payload: { processorId: 'arp-1', steps: createDefaultPattern(8) },
            })
        ).toBe(true);
        expect(
            handleSetYeastArpPattern.isNoop?.({
                type: 'setYeastArpPattern',
                payload: { processorId: 'arp-1', steps: patternWithFirstVelocity(64) },
            })
        ).toBe(false);
    });

    it('describes an inverse/redo pair returning the pre-gesture pattern', () => {
        seedRack({ processors: [arpProcessor({})], uiLevel: 3 });
        const steps = patternWithFirstVelocity(64);

        const described = handleSetYeastArpPattern.describe({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps },
        });

        expect(described.label).toBe('Set arp pattern');
        expect(described.inverseAction).toEqual({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps: createDefaultPattern(8), expectedSteps: steps },
        });
        expect(described.redoAction).toEqual({
            type: 'setYeastArpPattern',
            payload: { processorId: 'arp-1', steps, expectedSteps: createDefaultPattern(8) },
        });
    });

    it('validates against a prior same-processor sibling in the batch', () => {
        seedRack({ processors: [arpProcessor({})], uiLevel: 3 });
        const context = {
            actions: [
                { type: 'setYeastArpPattern' as const, payload: { processorId: 'arp-1', steps: patternWithFirstVelocity(64) } },
            ],
            actionIndex: 1,
        };

        expect(
            handleSetYeastArpPattern.validate!(
                {
                    type: 'setYeastArpPattern',
                    payload: {
                        processorId: 'arp-1',
                        steps: patternWithFirstVelocity(10),
                        expectedSteps: patternWithFirstVelocity(64),
                    },
                },
                context
            )
        ).toBe(true);
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleSetYeastArpPattern.undoable).toBe(true);
        expect(handleSetYeastArpPattern.canReportConflict).toBe(true);
    });
});
