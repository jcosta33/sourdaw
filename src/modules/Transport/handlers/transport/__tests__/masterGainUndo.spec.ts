import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreMasterGain } from '../handleRestoreMasterGain';
import { handleSetMasterGain } from '../handleSetMasterGain';

const mocks = vi.hoisted(() => {
    const transportStore: { value: { masterGain: number } | null } = { value: { masterGain: 80 } };
    return {
        replaceMasterGain: vi.fn(),
        setMasterGain: vi.fn(),
        transportStore,
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({ setMasterGain: mocks.setMasterGain }));
vi.mock('../../../stores/transportStore', () => ({ transportStore: mocks.transportStore }));
vi.mock('../../../useCases/replaceMasterGain', () => ({ replaceMasterGain: mocks.replaceMasterGain }));

describe('master-gain guarded replay handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transportStore.value = { masterGain: 80 };
        mocks.replaceMasterGain.mockReturnValue(true);
    });

    it('captures guarded replay and reconciles the live engine only after commit', async () => {
        const action = { type: 'setMasterGain', payload: { gain: 0.65 } } as const;

        expect(handleSetMasterGain.describe(action)).toEqual({
            label: 'Set master gain',
            inverseAction: {
                type: 'restoreMasterGain',
                payload: { expectedPercent: 65, replacementPercent: 80 },
            },
            redoAction: {
                type: 'restoreMasterGain',
                payload: { expectedPercent: 80, replacementPercent: 65 },
            },
        });
        const result = await handleSetMasterGain.execute(action);
        expect(result).toMatchObject({ status: 'written' });
        expect(mocks.replaceMasterGain).toHaveBeenCalledWith({ expectedPercent: 80, replacementPercent: 65 });
        expect(mocks.setMasterGain).not.toHaveBeenCalled();

        mocks.transportStore.value = { masterGain: 65 };
        await result?.afterCommit?.();
        mocks.transportStore.value = { masterGain: 70 };
        await result?.afterAmbiguousCommit?.();
        expect(mocks.setMasterGain).toHaveBeenNthCalledWith(1, 0.65);
        expect(mocks.setMasterGain).toHaveBeenNthCalledWith(2, 0.7);
    });

    it('conflicts instead of overwriting a newer durable value during replay', () => {
        const action = {
            type: 'restoreMasterGain',
            payload: { expectedPercent: 65, replacementPercent: 80 },
        } satisfies Parameters<typeof handleRestoreMasterGain.execute>[0];

        expect(handleRestoreMasterGain.canReapplyAfterDivergence?.(action)).toBe(true);
        expect(
            handleRestoreMasterGain.validate?.(action, {
                actions: [action],
                actionIndex: 0,
            })
        ).toBe(false);
        expect(handleRestoreMasterGain.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.replaceMasterGain).not.toHaveBeenCalled();
    });

    it('recognizes exact no-op public and replay values', () => {
        expect(handleSetMasterGain.isNoop?.({ type: 'setMasterGain', payload: { gain: 0.8 } })).toBe(true);
        mocks.transportStore.value = { masterGain: 29 };
        expect(handleSetMasterGain.isNoop?.({ type: 'setMasterGain', payload: { gain: 0.29 } })).toBe(true);
        mocks.transportStore.value = { masterGain: 80 };
        expect(
            handleRestoreMasterGain.isNoop?.({
                type: 'restoreMasterGain',
                payload: { expectedPercent: 65, replacementPercent: 80 },
            })
        ).toBe(true);
    });
});
