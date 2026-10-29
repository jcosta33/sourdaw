import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppActionCommittedError } from '../../errors/AppActionExecutionError';
import { type UndoEntry } from '../../models/UndoEntry';
import { revertActionGroup } from '../revertActionGroup';
import { revertActionGroupAtomically } from '../revertActionGroupAtomically';
import { runUndoRedoExclusive } from '../undoRedo';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        },
    },
    undoStoreSet: vi.fn<(state: import('../../stores/undoStore').UndoStoreState) => void>(),
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>().mockResolvedValue(undefined),
    undoTreeMoveTo: vi.fn<(id: string | null) => void>(),
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        set: mocks.undoStoreSet,
    },
}));

vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../executeAppActionBatch', () => ({
    executeAppActionBatch: mocks.executeAppActionBatch,
}));

vi.mock('../undoTree/undoTreeMoveTo', () => ({
    undoTreeMoveTo: mocks.undoTreeMoveTo,
}));

function actionEntry(id: string, groupId: string | undefined): Extract<UndoEntry, { kind: 'action' }> {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'ai',
        groupId,
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
    };
}

describe('revertActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
    });

    it('reverts every entry newest-first without undo or macro recording and rebuilds the split', async () => {
        const other = actionEntry('keep', 'g0');
        const g1 = actionEntry('1', 'g1');
        const g2 = actionEntry('2', 'g1');
        mocks.undoStoreValue.value = { past: [other, g1, g2], future: [] };

        await revertActionGroup('g1');

        // Inverse replays must not push fresh undo entries or leak into macro recording.
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            1,
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true, undoEntryId: g2.id }
        );
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(
            2,
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true, undoEntryId: g1.id }
        );
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        // Group entries are stripped from past and prepended (in order) to future.
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [other],
            future: [g1, g2],
        });
        // Undo-tree position follows the new top of past.
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('keep');
    });

    it('moves the undo tree to root when the group was the entire past stack', async () => {
        const g1 = actionEntry('1', 'g1');
        mocks.undoStoreValue.value = { past: [g1], future: [] };

        await revertActionGroup('g1');

        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith(null);
    });

    it('normalizes a keyless legacy trim inverse through the undo seam (#5198)', async () => {
        // A persisted AI group can carry entries recorded before inverses
        // carried anchors. The group-revert dispatch runs the same legacy
        // normalization the undo paths run: a payload without the anchor field
        // is a legacy entry whose pre-action clip was anchorless by
        // construction, and dispatching it as-is would run the fresh-action
        // mint law on replay, minting an anchor the pre-action state never
        // carried and bricking deeper legacy restores behind the conflict.
        const legacy: UndoEntry = {
            kind: 'action',
            id: 'legacy-trim',
            label: 'Trim clip start',
            timestamp: 0,
            source: 'ai',
            groupId: 'g1',
            action: { type: 'trimClipStart', payload: { clipId: 'c1', newStartBeat: 4 } },
            inverseAction: { type: 'trimClipStart', payload: { clipId: 'c1', newStartBeat: 2 } },
        };
        mocks.undoStoreValue.value = { past: [legacy], future: [] };

        await revertActionGroup('g1');

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(
            { type: 'trimClipStart', payload: { clipId: 'c1', newStartBeat: 2, loopOriginBeat: null } },
            {
                skipUndo: true,
                skipMacroRecording: true,
                undoEntryId: legacy.id,
                authorizeFirstHandler: expect.any(Function),
            }
        );
    });

    it('normalizes a keyless legacy loop inverse with an anchorless replacement (#5198)', async () => {
        const legacy: UndoEntry = {
            kind: 'action',
            id: 'legacy-loop',
            label: 'Enable clip loop',
            timestamp: 0,
            source: 'ai',
            groupId: 'g1',
            action: { type: 'setClipLoop', payload: { clipId: 'c1', enabled: false } },
            inverseAction: {
                type: 'restoreClipLoop',
                payload: {
                    clipId: 'c1',
                    expected: { present: true, enabled: false },
                    replacement: { present: true, enabled: true },
                },
            },
        };
        mocks.undoStoreValue.value = { past: [legacy], future: [] };

        await revertActionGroup('g1');

        // The replacement — the state put back — normalizes to the explicit
        // anchorless form; the expected snapshot is untouched, because the
        // compare-and-swap guard reads only presence and enabled.
        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(
            {
                type: 'restoreClipLoop',
                payload: {
                    clipId: 'c1',
                    expected: { present: true, enabled: false },
                    replacement: { present: true, enabled: true, loopOriginBeat: null },
                },
            },
            { skipUndo: true, skipMacroRecording: true, undoEntryId: legacy.id }
        );
    });

    it('leaves the store untouched when no member of the group could be undone', async () => {
        const inert: UndoEntry = {
            kind: 'action',
            id: 'x',
            label: 'x',
            timestamp: 0,
            source: 'ai',
            groupId: 'g1',
            action: { type: 'togglePlayback' },
            inverseAction: null,
        };
        mocks.undoStoreValue.value = { past: [inert], future: [] };

        await revertActionGroup('g1');

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it('is a no-op when the group is absent from past', async () => {
        mocks.undoStoreValue.value = { past: [actionEntry('a', 'gX')], future: [] };

        await revertActionGroup('g1');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
    });

    it('waits behind an in-flight undo mutation before reading or reverting the group', async () => {
        const group = actionEntry('1', 'g1');
        mocks.undoStoreValue.value = { past: [group], future: [] };
        let releaseMutation: (() => void) | undefined;
        const mutationGate = new Promise<void>((resolve) => {
            releaseMutation = resolve;
        });
        const inFlightMutation = runUndoRedoExclusive(async () => mutationGate);

        const revert = revertActionGroup('g1');
        await Promise.resolve();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        releaseMutation?.();
        await Promise.all([inFlightMutation, revert]);
        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(
            { type: 'toggleRecording' },
            { skipUndo: true, skipMacroRecording: true, undoEntryId: '1' }
        );
    });

    it('preserves an action committed while a group inverse is in flight', async () => {
        const other = actionEntry('keep', 'g0');
        const group = actionEntry('group', 'g1');
        const concurrent = actionEntry('concurrent', 'g2');
        mocks.undoStoreValue.value = { past: [other, group], future: [] };
        mocks.executeAppAction.mockImplementationOnce(() => {
            mocks.undoStoreValue.value = { past: [other, group, concurrent], future: [] };
            return Promise.resolve(undefined);
        });

        await revertActionGroup('g1');

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({
            past: [other, concurrent],
            future: [group],
        });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('concurrent');
    });

    it('moves only successfully reverted members when a mixed group contains an inert entry', async () => {
        const inert = { ...actionEntry('inert', 'g1'), inverseAction: null } satisfies UndoEntry;
        const reverted = actionEntry('reverted', 'g1');
        mocks.undoStoreValue.value = { past: [inert, reverted], future: [] };

        await revertActionGroup('g1');

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [inert], future: [reverted] });
    });

    it('commits successful newer inverses before rethrowing an older failure', async () => {
        const failed = actionEntry('failed', 'g1');
        const reverted = actionEntry('reverted', 'g1');
        const failure = new Error('inverse failed');
        mocks.undoStoreValue.value = { past: [failed, reverted], future: [] };
        mocks.executeAppAction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);

        await expect(revertActionGroup('g1')).rejects.toBe(failure);

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [failed], future: [reverted] });
    });

    it('moves an inverse that committed before its post-commit failure', async () => {
        const committed = actionEntry('committed', 'g1');
        const failure = new AppActionCommittedError('toggleRecording', new Error('after commit'));
        mocks.undoStoreValue.value = { past: [committed], future: [] };
        mocks.executeAppAction.mockRejectedValueOnce(failure);

        await expect(revertActionGroup('g1')).rejects.toBe(failure);

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [committed] });
    });
});

describe('revertActionGroupAtomically', () => {
    function groupEntry(id: string, inverse: string): Extract<UndoEntry, { kind: 'action' }> {
        return {
            ...actionEntry(id, 'g1'),
            inverseAction: { type: 'setTrackPan', payload: { trackId: inverse, pan: 0, expectedPan: 0.5 } },
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
        mocks.executeAppActionBatch.mockImplementation(async (actions, options) => {
            options?.onCommitted?.(actions);
            return { status: 'committed', actions: [] };
        });
    });

    it('replays the whole group newest-first as one batch and moves it to future', async () => {
        const other = actionEntry('keep', 'g0');
        const older = groupEntry('older', 'track-a');
        const newer = groupEntry('newer', 'track-b');
        mocks.undoStoreValue.value = { past: [other, older, newer], future: [] };

        await expect(revertActionGroupAtomically('g1')).resolves.toEqual({ status: 'reverted', warning: null });

        expect(mocks.executeAppActionBatch).toHaveBeenCalledExactlyOnceWith(
            [newer.inverseAction, older.inverseAction],
            {
                skipUndo: true,
                skipMacroRecording: true,
                source: 'ai',
                undoEntryIds: [newer.id, older.id],
                onCommitted: expect.any(Function),
                onAmbiguousCommit: expect.any(Function),
            }
        );
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [other], future: [older, newer] });
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledWith('keep');
    });

    it('writes nothing and names the conflict when any inverse conflicts', async () => {
        mocks.undoStoreValue.value = {
            past: [groupEntry('older', 'track-a'), groupEntry('newer', 'track-b')],
            future: [],
        };
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: setTrackPan',
            actions: [],
        });

        await expect(revertActionGroupAtomically('g1')).resolves.toEqual({
            status: 'refused',
            reason: 'conflict',
            detail: 'Action conflicts with current project state: setTrackPan',
        });

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it.each([
        ['absent from past', { past: [actionEntry('a', 'gX')], future: [] }],
        ['held partly in future', { past: [groupEntry('older', 'track-a')], future: [groupEntry('newer', 'track-b')] }],
    ])('refuses a group %s without replaying anything', async (_label, history) => {
        mocks.undoStoreValue.value = history;

        await expect(revertActionGroupAtomically('g1')).resolves.toMatchObject({
            status: 'refused',
            reason: 'not-applied',
        });

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
    });

    it.each([
        ['an inverse-less member', { ...groupEntry('inert', 'track-a'), inverseAction: null }],
        [
            'a callback member',
            {
                kind: 'callback',
                id: 'callback',
                label: 'callback',
                timestamp: 0,
                source: 'ai',
                groupId: 'g1',
                undo: vi.fn(),
                redo: vi.fn(),
            },
        ],
    ] satisfies Array<[string, UndoEntry]>)(
        'refuses a group holding %s without replaying anything',
        async (_label, entry) => {
            mocks.undoStoreValue.value = { past: [entry, groupEntry('newer', 'track-b')], future: [] };

            await expect(revertActionGroupAtomically('g1')).resolves.toMatchObject({
                status: 'refused',
                reason: 'not-replayable',
            });

            expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        }
    );

    function holdGroupOf(...entries: UndoEntry[]): void {
        mocks.undoStoreValue.value = { past: entries, future: [] };
    }

    it("hands the caller's shouldExecute to the batch as its last check before it writes", async () => {
        holdGroupOf(groupEntry('older', 'track-a'), groupEntry('newer', 'track-b'));
        const shouldExecute = () => false;

        await revertActionGroupAtomically('g1', { shouldExecute });

        expect(mocks.executeAppActionBatch).toHaveBeenCalledExactlyOnceWith(
            expect.any(Array),
            expect.objectContaining({ shouldExecute })
        );
    });

    it('refuses a cancelled batch as a conflict, moving nothing', async () => {
        holdGroupOf(groupEntry('older', 'track-a'), groupEntry('newer', 'track-b'));
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'cancelled',
            reason: 'Batch execution authority was revoked',
            actions: [],
        });

        await expect(revertActionGroupAtomically('g1')).resolves.toEqual({
            status: 'refused',
            reason: 'conflict',
            detail: 'Batch execution authority was revoked',
        });

        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it.each(['rejected', 'failed'] as const)(
        'throws a %s batch as a failed write, never a refusal, moving nothing',
        async (status) => {
            holdGroupOf(groupEntry('older', 'track-a'), groupEntry('newer', 'track-b'));
            mocks.executeAppActionBatch.mockResolvedValue({ status, reason: 'The inverse write failed', actions: [] });

            await expect(revertActionGroupAtomically('g1')).rejects.toThrow(
                'Grouped undo failed: The inverse write failed'
            );

            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        }
    );

    it.each([
        ['an ambiguous batch', { status: 'ambiguous', reason: 'The write may have landed', actions: [] }],
        [
            'a batch committed with a warning',
            { status: 'committed-with-warning', warning: 'The write may have landed', actions: [] },
        ],
    ] satisfies Array<[string, Awaited<ReturnType<typeof mocks.executeAppActionBatch>>]>)(
        'reports %s as reverted with its own warning, moving the group to future',
        async (_label, result) => {
            const older = groupEntry('older', 'track-a');
            const newer = groupEntry('newer', 'track-b');
            holdGroupOf(older, newer);
            mocks.executeAppActionBatch.mockImplementation(async (actions, options) => {
                if (result.status === 'ambiguous') {
                    options?.onAmbiguousCommit?.();
                } else {
                    options?.onCommitted?.(actions);
                }
                return result;
            });

            await expect(revertActionGroupAtomically('g1')).resolves.toEqual({
                status: 'reverted',
                warning: 'The write may have landed',
            });

            expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [older, newer] });
        }
    );

    it('puts the reverted group ahead of the redo entries already in future', async () => {
        const reverted = groupEntry('reverted', 'track-a');
        const redoable = actionEntry('redoable', 'g2');
        mocks.undoStoreValue.value = { past: [reverted], future: [redoable] };

        await revertActionGroupAtomically('g1');

        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [reverted, redoable] });
    });

    it('replays a group whose members carry different sources under the source of its oldest member', async () => {
        // Coalescing joins an entry to the group of the one before it whatever that one's source.
        const older = { ...groupEntry('older', 'track-a'), source: 'manual' } satisfies UndoEntry;
        const newer = groupEntry('newer', 'track-b');
        holdGroupOf(older, newer);

        await revertActionGroupAtomically('g1');

        expect(mocks.executeAppActionBatch).toHaveBeenCalledExactlyOnceWith(
            [newer.inverseAction, older.inverseAction],
            {
                skipUndo: true,
                skipMacroRecording: true,
                source: 'manual',
                undoEntryIds: [newer.id, older.id],
                onCommitted: expect.any(Function),
                onAmbiguousCommit: expect.any(Function),
            }
        );
    });

    it('finalizes once at commit before later effects clear the history', async () => {
        const older = groupEntry('older', 'track-a');
        const newer = groupEntry('newer', 'track-b');
        holdGroupOf(older, newer);
        mocks.executeAppActionBatch.mockImplementation(async (actions, options) => {
            options?.onCommitted?.(actions);
            expect(mocks.undoStoreSet).toHaveBeenCalledExactlyOnceWith({ past: [], future: [older, newer] });
            mocks.undoStoreValue.value = { past: [], future: [] };
            return { status: 'committed-with-warning', warning: 'Effect failed after clear', actions: [] };
        });

        await expect(revertActionGroupAtomically('g1')).resolves.toEqual({
            status: 'reverted',
            warning: 'Effect failed after clear',
        });

        expect(mocks.undoStoreSet).toHaveBeenCalledOnce();
        expect(mocks.undoTreeMoveTo).toHaveBeenCalledOnce();
    });

    it.each(['cleared', 'restored copies', 'restored originals'] as const)(
        'does not finalize again after ambiguous %s history',
        async (transition) => {
            const older = groupEntry('older', 'track-a');
            const newer = groupEntry('newer', 'track-b');
            holdGroupOf(older, newer);
            mocks.executeAppActionBatch.mockImplementation(async (_actions, options) => {
                options?.onAmbiguousCommit?.();
                expect(mocks.undoStoreSet).toHaveBeenCalledExactlyOnceWith({ past: [], future: [older, newer] });
                let past: UndoEntry[] = [older, newer];
                if (transition === 'cleared') {
                    past = [];
                } else if (transition === 'restored copies') {
                    past = structuredClone([older, newer]);
                }
                mocks.undoStoreValue.value = { past, future: [] };
                return { status: 'ambiguous', reason: 'Publication observer failed', actions: [] };
            });

            await expect(revertActionGroupAtomically('g1')).resolves.toEqual({
                status: 'reverted',
                warning: 'Publication observer failed',
            });

            expect(mocks.undoStoreSet).toHaveBeenCalledOnce();
            expect(mocks.undoTreeMoveTo).toHaveBeenCalledOnce();
        }
    );

    it('settles a no-op replay without requiring a commit observer', async () => {
        const entry = groupEntry('already-at-value', 'track-a');
        holdGroupOf(entry);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'no-op', actions: [] });

        await expect(revertActionGroupAtomically('g1')).resolves.toEqual({ status: 'reverted', warning: null });

        expect(mocks.undoStoreSet).toHaveBeenCalledExactlyOnceWith({ past: [], future: [entry] });
    });

    it('refuses a no-op whose caller authority was revoked before history settlement', async () => {
        const entry = groupEntry('already-at-value', 'track-a');
        holdGroupOf(entry);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let authorized = true;
        const shouldExecute = vi.fn(() => authorized);
        mocks.executeAppActionBatch.mockImplementation(async () => {
            entered.resolve();
            await release.promise;
            return { status: 'no-op', actions: [] };
        });

        const revert = revertActionGroupAtomically('g1', { shouldExecute });
        await entered.promise;
        authorized = false;
        release.resolve();

        await expect(revert).resolves.toMatchObject({ status: 'refused', reason: 'conflict' });
        expect(shouldExecute).toHaveBeenCalledOnce();
        expect(mocks.undoStoreSet).not.toHaveBeenCalled();
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
    });

    it.each(['cleared', 'restored originals', 'appended entry'] as const)(
        'refuses a no-op whose history was %s without relying on project authority',
        async (transition) => {
            const entry = groupEntry('already-at-value', 'track-a');
            holdGroupOf(entry);
            const appended = actionEntry('later-musician-edit', undefined);
            mocks.executeAppActionBatch.mockImplementation(async () => {
                let past: UndoEntry[] = [entry];
                if (transition === 'cleared') {
                    past = [];
                } else if (transition === 'appended entry') {
                    past = [entry, appended];
                }
                mocks.undoStoreValue.value = { past, future: [] };
                return { status: 'no-op', actions: [] };
            });

            await expect(revertActionGroupAtomically('g1')).resolves.toMatchObject({
                status: 'refused',
                reason: 'not-applied',
            });

            expect(mocks.undoStoreSet).not.toHaveBeenCalled();
            expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        }
    );

    it.each(['committed', 'ambiguous'] as const)(
        'retains a %s publication when authority changes afterward',
        async (status) => {
            const entry = groupEntry('written', 'track-a');
            holdGroupOf(entry);
            let authorized = true;
            const shouldExecute = vi.fn(() => authorized);
            mocks.executeAppActionBatch.mockImplementation(async (actions, options) => {
                if (status === 'ambiguous') {
                    options?.onAmbiguousCommit?.();
                    authorized = false;
                    return { status: 'ambiguous', reason: 'Publication observer failed', actions: [] };
                }
                options?.onCommitted?.(actions);
                authorized = false;
                return { status: 'committed', actions: [] };
            });

            await expect(revertActionGroupAtomically('g1', { shouldExecute })).resolves.toMatchObject({
                status: 'reverted',
            });

            expect(shouldExecute).not.toHaveBeenCalled();
            expect(mocks.undoStoreSet).toHaveBeenCalledExactlyOnceWith({ past: [], future: [entry] });
        }
    );
});
