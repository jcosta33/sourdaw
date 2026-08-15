import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateTrack } from '../duplicateTrack';

const mocks = vi.hoisted(() => ({
    duplicateTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; name?: string; kind: string }[] } | null>(),
    publishTrackAdded: vi.fn(),
}));

vi.mock('../../../useCases/duplicateTrack', () => ({
    duplicateTrack: mocks.duplicateTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));
vi.mock('../../../useCases/publishTrackAdded', () => ({
    publishTrackAdded: mocks.publishTrackAdded,
}));

describe('handleDuplicateTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', name: 'Source', kind: 'audio' }] });
    });

    it('honors an app-owned selection policy and publishes only after commit', async () => {
        const action: Parameters<typeof handleDuplicateTrack.describe>[0] = {
            type: 'duplicateTrack',
            payload: { trackId: 't1', select: false },
        };
        const described = handleDuplicateTrack.describe(action);
        const targetTrackId = action.payload.targetTrackId;
        if (!targetTrackId) {
            throw new Error('Expected describe to prepare a destination track id');
        }
        const createdDuplicate = { id: targetTrackId, name: 'Copy', kind: 'audio' };
        mocks.duplicateTrack.mockReturnValue(createdDuplicate);
        // The guard finalizes from the committed store track — the use case's
        // return value predates its own copy steps.
        const committedDuplicate = { id: targetTrackId, name: 'Copy', kind: 'audio', clips: [] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', name: 'Source', kind: 'audio' }, committedDuplicate],
        });

        const result = await handleDuplicateTrack.execute(action);

        // Execute finalizes the guard embedded in the inverse from the
        // committed store shape; an unfinalized or stale entityJson would
        // make undo of a duplicate conflict-fail against
        // isGeneratedMidiStateCurrent.
        const inverse = described?.inverseAction;
        if (!inverse || inverse.type !== 'discardCreatedTrack') {
            throw new Error('Expected a discardCreatedTrack inverse');
        }
        expect(inverse.payload.generatedMidiStateGuard?.entityJson).toBe(JSON.stringify(committedDuplicate));

        expect(mocks.duplicateTrack).toHaveBeenCalledWith('t1', {
            select: false,
            suppressAddedEvent: true,
            targetTrackId,
        });
        expect(targetTrackId).toMatch(/^track-dup-/);
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();

        await result?.afterCommit?.();

        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: targetTrackId,
            name: 'Copy',
            kind: 'audio',
        });
    });

    it('provides an inverse that removes the exact duplicate', () => {
        const action: Parameters<typeof handleDuplicateTrack.describe>[0] = {
            type: 'duplicateTrack',
            payload: { trackId: 't1' },
        };
        const desc = handleDuplicateTrack.describe(action);
        const targetTrackId = action.payload.targetTrackId;
        if (!targetTrackId) {
            throw new Error('Expected describe to prepare a destination track id');
        }

        expect(desc.label).toBe('Duplicate track');
        expect(desc.inverseAction).toEqual({
            type: 'discardCreatedTrack',
            payload: {
                trackId: targetTrackId,
                // The guard keeps the discard inverse reapply-safe inside
                // atomic batches; execute finalizes entityJson once the
                // duplicate lands.
                generatedMidiStateGuard: {
                    entityJson: '',
                    midiByClipIdJson: '{}',
                },
            },
        });
        expect(targetTrackId).toMatch(/^track-dup-/);
    });

    it('publishes only a duplicate found in durable truth after an ambiguous commit', async () => {
        const action = {
            type: 'duplicateTrack',
            payload: { trackId: 't1', targetTrackId: 'copy' },
        } as const;
        mocks.duplicateTrack.mockReturnValue({ id: 'copy', name: 'Requested Copy', kind: 'audio' });
        const result = await handleDuplicateTrack.execute(action);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', name: 'Source', kind: 'audio' },
                { id: 'copy', name: 'Committed Copy', kind: 'audio' },
            ],
        });

        await result?.afterAmbiguousCommit?.();

        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: 'copy',
            name: 'Committed Copy',
            kind: 'audio',
        });
    });

    it('preserves the default selection behavior for ordinary commands', async () => {
        const action: Parameters<typeof handleDuplicateTrack.describe>[0] = {
            type: 'duplicateTrack',
            payload: { trackId: 't1' },
        };
        handleDuplicateTrack.describe(action);
        const targetTrackId = action.payload.targetTrackId;
        if (!targetTrackId) {
            throw new Error('Expected describe to prepare a destination track id');
        }
        mocks.duplicateTrack.mockReturnValue({ id: targetTrackId, name: 'Copy', kind: 'audio' });

        await handleDuplicateTrack.execute(action);

        expect(mocks.duplicateTrack).toHaveBeenCalledWith('t1', {
            suppressAddedEvent: true,
            targetTrackId,
        });
    });

    it('conflicts when the source is missing and no-ops only when the prepared target already exists', () => {
        const missingSource = {
            type: 'duplicateTrack',
            payload: { trackId: 'missing' },
        } as const;
        const collidingTarget = {
            type: 'duplicateTrack',
            payload: { trackId: 't1', targetTrackId: 'existing' },
        } as const;

        expect(handleDuplicateTrack.describe(missingSource).inverseAction).toBeNull();
        expect(handleDuplicateTrack.isNoop?.(missingSource)).toBe(false);
        expect(handleDuplicateTrack.execute(missingSource)).toEqual({ status: 'conflict' });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio' },
                { id: 'existing', kind: 'audio' },
            ],
        });
        expect(handleDuplicateTrack.describe(collidingTarget).inverseAction).toBeNull();
        expect(handleDuplicateTrack.isNoop?.(collidingTarget)).toBe(true);
    });

    it('rejects the singleton master track as a conflict', () => {
        const action = {
            type: 'duplicateTrack',
            payload: { trackId: 'master' },
        } as const;
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'master', kind: 'master' }] });

        expect(handleDuplicateTrack.describe(action).inverseAction).toBeNull();
        expect(handleDuplicateTrack.isNoop?.(action)).toBe(false);
        expect(handleDuplicateTrack.execute(action)).toEqual({ status: 'conflict' });
    });

    it('is undoable', () => {
        expect(handleDuplicateTrack.undoable).toBe(true);
    });
});
