import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleToggleSoloSafe } from '../toggleSoloSafe';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setSoloSafe: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/toggleTrackState/setSoloSafe', () => ({ setSoloSafe: mocks.setSoloSafe }));
vi.mock('../../../useCases/toggleTrackState/applySoloLogic', () => ({ applySoloLogic: mocks.applySoloLogic }));

describe('handleToggleSoloSafe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setSoloSafe.mockReturnValue(true);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', soloSafe: false }] });
    });

    it('resolves the target value from the live track and defers the engine effect to commit', async () => {
        const result = await handleToggleSoloSafe.execute({
            type: 'toggleSoloSafe',
            payload: { trackId: 't1' },
        });

        expect(mocks.setSoloSafe).toHaveBeenCalledWith({
            trackId: 't1',
            soloSafe: true,
            deferRuntimeEffect: true,
        });
        expect(result).toMatchObject({ status: 'written' });
        // The engine side effect must not precede the CRDT commit.
        expect(mocks.applySoloLogic).not.toHaveBeenCalled();
        await result?.afterCommit?.();
        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });

    it('reports no-write for a track the store does not know', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        expect(handleToggleSoloSafe.execute({ type: 'toggleSoloSafe', payload: { trackId: 'gone' } })).toEqual({
            status: 'no-write',
        });
        expect(mocks.setSoloSafe).not.toHaveBeenCalled();
    });

    it('describes a guarded restoreSoloSafe inverse rather than a second toggle', () => {
        expect(handleToggleSoloSafe.describe({ type: 'toggleSoloSafe', payload: { trackId: 't1' } })).toEqual({
            label: 'Toggle solo safe',
            inverseAction: {
                type: 'restoreSoloSafe',
                payload: { trackId: 't1', expected: true, replacement: false },
            },
            redoAction: {
                type: 'restoreSoloSafe',
                payload: { trackId: 't1', expected: false, replacement: true },
            },
        });
    });

    it('emits no inverse for a track the store does not know', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        expect(handleToggleSoloSafe.describe({ type: 'toggleSoloSafe', payload: { trackId: 'gone' } })).toMatchObject({
            inverseAction: null,
        });
    });

    it('is undoable', () => {
        expect(handleToggleSoloSafe.undoable).toBe(true);
    });
});
