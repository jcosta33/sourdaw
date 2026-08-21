import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { handleRestoreMasterGain } from '../handleRestoreMasterGain';
import { handleSetMasterGain } from '../handleSetMasterGain';

/**
 * The action path, end to end, through the **real** `replaceMasterGain`.
 *
 * Every other master-gain handler spec substitutes that use case, so the guard
 * inside it — the only thing standing between `action.payload.gain * 100` and
 * the durable field — is observed by none of them. It gated on the literal
 * `100` while the field's ceiling is `MAX_MASTER_GAIN` (`100 * FADER_MAX_GAIN`,
 * ≈199.53), so an AI-sourced or command-sourced request for make-up gain
 * silently no-wrote, and the undo that quotes the same out-of-interval value as
 * its `expectedPercent` was refused with it.
 *
 * Only the store object is substituted here: the repositories, the use case,
 * and both handlers are the shipping code.
 */
const mocks = vi.hoisted(() => {
    const state: { value: TransportState | null } = { value: null };
    return {
        state,
        engineSetMasterGain: vi.fn(),
        store: {
            get value() {
                return state.value;
            },
            set(next: TransportState) {
                state.value = next;
            },
        },
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({ setMasterGain: mocks.engineSetMasterGain }));

vi.mock('../../../stores/transportStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/transportStore')>();
    return { ...actual, transportStore: mocks.store };
});

const HEADROOM_GAIN = 1.5;
const HEADROOM_PERCENT = 150;
const START_PERCENT = 80;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.value = { ...defaultTransportState, masterGain: START_PERCENT };
});

describe('master gain above unity through the real guarded write', () => {
    it('writes a headroom gain the fader can reach instead of silently no-writing', async () => {
        const result = await handleSetMasterGain.execute({
            type: 'setMasterGain',
            payload: { gain: HEADROOM_GAIN },
        });

        expect(result).toMatchObject({ status: 'written' });
        expect(mocks.state.value?.masterGain).toBe(HEADROOM_PERCENT);
    });

    it('undoes a headroom gain back to where the fader started', async () => {
        const action = { type: 'setMasterGain', payload: { gain: HEADROOM_GAIN } } as const;
        const inverse = handleSetMasterGain.describe(action).inverseAction;
        await handleSetMasterGain.execute(action);
        expect(mocks.state.value?.masterGain).toBe(HEADROOM_PERCENT);

        if (inverse?.type !== 'restoreMasterGain') {
            throw new Error(`expected a restoreMasterGain inverse, got ${String(inverse?.type)}`);
        }
        expect(inverse.payload).toEqual({ expectedPercent: HEADROOM_PERCENT, replacementPercent: START_PERCENT });

        const undone = handleRestoreMasterGain.execute(inverse);

        expect(undone).toMatchObject({ status: 'written' });
        expect(mocks.state.value?.masterGain).toBe(START_PERCENT);
    });
});
