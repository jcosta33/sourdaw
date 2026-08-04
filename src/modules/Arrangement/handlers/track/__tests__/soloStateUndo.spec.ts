import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleClearSolos } from '../clearSolos';
import { handleRestoreSoloSafe } from '../restoreSoloSafe';
import { handleRestoreTrackSoloStates } from '../restoreTrackSoloStates';
import { handleSetSoloSafe } from '../setSoloSafe';

const mocks = vi.hoisted(() => ({
    clearSolos: vi.fn(),
    getTrackStoreState: vi.fn(),
    restoreTrackSoloStates: vi.fn(),
    setSoloSafe: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/toggleTrackState/clearSolos', () => ({ clearSolos: mocks.clearSolos }));
vi.mock('../../../useCases/toggleTrackState/restoreTrackSoloStates', () => ({
    restoreTrackSoloStates: mocks.restoreTrackSoloStates,
}));
vi.mock('../../../useCases/toggleTrackState/setSoloSafe', () => ({ setSoloSafe: mocks.setSoloSafe }));
vi.mock('../../../useCases/toggleTrackState/applySoloLogic', () => ({ applySoloLogic: mocks.applySoloLogic }));

describe('solo-state guarded replay handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clearSolos.mockReturnValue(true);
        mocks.restoreTrackSoloStates.mockReturnValue(true);
        mocks.setSoloSafe.mockReturnValue(true);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'vocals', soloed: true, soloSafe: false },
                { id: 'drums', soloed: false, soloSafe: true },
            ],
        });
    });

    it('captures guarded replay and defers live-engine reconciliation until commit', async () => {
        const action = { type: 'setSoloSafe', payload: { trackId: 'vocals', soloSafe: true } } as const;

        expect(handleSetSoloSafe.describe(action)).toEqual({
            label: 'Enable solo safe',
            inverseAction: {
                type: 'restoreSoloSafe',
                payload: { trackId: 'vocals', expected: true, replacement: false },
            },
            redoAction: {
                type: 'restoreSoloSafe',
                payload: { trackId: 'vocals', expected: false, replacement: true },
            },
        });
        expect(handleSetSoloSafe.isNoop?.(action)).toBe(false);
        const result = await handleSetSoloSafe.execute(action);
        expect(result).toMatchObject({ status: 'written' });
        expect(mocks.setSoloSafe).toHaveBeenCalledWith({
            trackId: 'vocals',
            soloSafe: true,
            deferRuntimeEffect: true,
        });
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
        await result?.afterCommit?.();
        await result?.afterAmbiguousCommit?.();
        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(2);
    });

    it('conflicts instead of overwriting a newer solo-safe state during replay', () => {
        const action = {
            type: 'restoreSoloSafe',
            payload: { trackId: 'vocals', expected: true, replacement: false },
        } satisfies Parameters<typeof handleRestoreSoloSafe.execute>[0];

        expect(handleRestoreSoloSafe.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.setSoloSafe).not.toHaveBeenCalled();
    });

    it('captures only tracks changed by clearSolos and restores them exactly', () => {
        const description = handleClearSolos.describe({ type: 'clearSolos' });

        expect(description).toEqual({
            label: 'Clear all solos',
            inverseAction: {
                type: 'restoreTrackSoloStates',
                payload: {
                    expected: [{ trackId: 'vocals', soloed: false }],
                    replacement: [{ trackId: 'vocals', soloed: true }],
                },
            },
            redoAction: {
                type: 'restoreTrackSoloStates',
                payload: {
                    expected: [{ trackId: 'vocals', soloed: true }],
                    replacement: [{ trackId: 'vocals', soloed: false }],
                },
            },
        });
        const result = handleClearSolos.execute({ type: 'clearSolos' });
        expect(result).toMatchObject({ status: 'written' });
        expect(mocks.clearSolos).toHaveBeenCalledWith({ deferRuntimeEffect: true });
    });

    it('rejects stale or duplicate multi-track replay snapshots', () => {
        const stale = {
            type: 'restoreTrackSoloStates',
            payload: {
                expected: [{ trackId: 'vocals', soloed: false }],
                replacement: [{ trackId: 'vocals', soloed: true }],
            },
        } satisfies Parameters<typeof handleRestoreTrackSoloStates.execute>[0];
        const duplicate = {
            type: 'restoreTrackSoloStates',
            payload: {
                expected: [
                    { trackId: 'vocals', soloed: true },
                    { trackId: 'vocals', soloed: true },
                ],
                replacement: [{ trackId: 'vocals', soloed: false }],
            },
        } satisfies Parameters<typeof handleRestoreTrackSoloStates.execute>[0];
        const mismatchedTargets = {
            type: 'restoreTrackSoloStates',
            payload: {
                expected: [{ trackId: 'vocals', soloed: true }],
                replacement: [{ trackId: 'drums', soloed: false }],
            },
        } satisfies Parameters<typeof handleRestoreTrackSoloStates.execute>[0];

        expect(handleRestoreTrackSoloStates.execute(stale)).toEqual({ status: 'conflict' });
        expect(handleRestoreTrackSoloStates.execute(duplicate)).toEqual({ status: 'conflict' });
        expect(handleRestoreTrackSoloStates.execute(mismatchedTargets)).toEqual({ status: 'conflict' });
        expect(mocks.restoreTrackSoloStates).not.toHaveBeenCalled();
    });
});
