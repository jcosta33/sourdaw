import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    describe: vi.fn(),
    isNoop: vi.fn(),
}));

vi.mock('../handleAddTrack', () => ({
    handleAddTrack: {
        execute: mocks.execute,
        describe: mocks.describe,
        isNoop: mocks.isNoop,
    },
}));

import { handleCreateBus } from '../handleCreateBus';

describe('handleCreateBus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.describe.mockReturnValue({
            label: 'Add bus track',
            inverseAction: { type: 'discardCreatedTrack', payload: { trackId: 'bus-1' } },
        });
        mocks.isNoop.mockReturnValue(false);
    });

    it('executes through the canonical add-track handler with a stable bus identity', async () => {
        const deferredEffects = { status: 'written' as const, afterCommit: vi.fn(), afterAmbiguousCommit: vi.fn() };
        mocks.execute.mockReturnValue(deferredEffects);
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Reverb Bus', busId: 'bus-1' },
        };

        const result = await handleCreateBus.execute(action);

        expect(mocks.execute).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { id: 'bus-1', name: 'Reverb Bus', kind: 'bus' },
        });
        expect(result).toBe(deferredEffects);
    });

    it('prepares one replay identity and preserves the add-track inverse', () => {
        const action: Parameters<typeof handleCreateBus.describe>[0] = {
            type: 'createBus',
            payload: { name: 'Drum Bus' },
        };

        const description = handleCreateBus.describe(action);
        const busId = action.payload.busId;
        if (!busId) {
            throw new Error('Expected describe to prepare a bus id');
        }

        expect(busId).toMatch(/^bus-ai-/);
        expect(mocks.describe).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { id: busId, name: 'Drum Bus', kind: 'bus' },
        });
        expect(description).toEqual({
            label: 'Create bus "Drum Bus"',
            inverseAction: { type: 'discardCreatedTrack', payload: { trackId: 'bus-1' } },
        });
    });

    it('delegates no-op detection for retry-safe receipts', () => {
        mocks.isNoop.mockReturnValue(true);
        const action = {
            type: 'createBus' as const,
            payload: { name: 'Parallel Bus', busId: 'bus-existing' },
        };

        expect(handleCreateBus.isNoop?.(action)).toBe(true);
        expect(mocks.isNoop).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { id: 'bus-existing', name: 'Parallel Bus', kind: 'bus' },
        });
    });

    it('is undoable without pre-commit abort compensation', () => {
        expect(handleCreateBus.undoable).toBe(true);
        expect(handleCreateBus.requiresAbortCompensation).toBe(false);
    });
});
