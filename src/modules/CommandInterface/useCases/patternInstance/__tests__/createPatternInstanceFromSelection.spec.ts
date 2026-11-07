import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPatternInstanceFromSelection } from '../createPatternInstanceFromSelection';

type Clip = { id: string; type: 'midi' | 'audio'; startBeat: number; endBeat: number };
type State = { tracks: Array<{ id: string; clips: Clip[] }> };

const mocks = vi.hoisted(() => {
    const state: { value: State | null } = { value: null };
    const selected: { id: string | null; value: object } = { id: 'source', value: {} };
    return {
        state,
        selected,
        project: { id: 'project' },
        dispatch: vi.fn<typeof import('#/modules/Command/useCases').executeUserAppAction>(),
        isCommitted: vi.fn<(error: unknown) => boolean>(),
        allocate: vi.fn(() => 'copy'),
        select: vi.fn<(clipId: string) => void>(),
        error: vi.fn(),
    };
});
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.error } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.state,
    clipSelectionStore: {
        get value() {
            return mocks.selected.value;
        },
    },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    prepareDuplicateClipTargetId: mocks.allocate,
    selectClipWithFocus: mocks.select,
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: mocks.dispatch,
    isAppActionCommittedError: mocks.isCommitted,
}));
vi.mock('#/modules/CrdtDocument/stores', () => ({ captureProjectIdentity: () => mocks.project.id }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: () => mocks.selected.id }));

function publishCopy() {
    mocks.state.value?.tracks[0]?.clips.push({ id: 'copy', type: 'midi', startBeat: 10, endBeat: 16 });
}

describe('createPatternInstanceFromSelection boundary settlement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.selected.id = 'source';
        mocks.selected.value = {};
        mocks.project.id = 'project';
        mocks.state.value = {
            tracks: [{ id: 'owner', clips: [{ id: 'source', type: 'midi', startBeat: 4, endBeat: 10 }] }],
        };
        mocks.dispatch.mockResolvedValue(undefined);
        mocks.isCommitted.mockReturnValue(false);
    });

    it('returns before identity allocation or dispatch when selection is missing or not MIDI', async () => {
        mocks.selected.id = null;
        expect(await createPatternInstanceFromSelection()).toBe(false);
        mocks.selected.id = 'source';
        const source = mocks.state.value?.tracks[0]?.clips[0];
        if (!source) {
            throw new Error('Expected source fixture');
        }
        source.type = 'audio';
        expect(await createPatternInstanceFromSelection()).toBe(false);
        expect(mocks.allocate).not.toHaveBeenCalled();
        expect(mocks.dispatch).not.toHaveBeenCalled();
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it('dispatches the exact owning target and placement once, then selects the witnessed copy', async () => {
        mocks.dispatch.mockImplementation(async () => {
            publishCopy();
        });
        expect(await createPatternInstanceFromSelection()).toBe(true);
        expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
            {
                type: 'createPatternInstance',
                payload: { sourceClipId: 'source', targetTrackId: 'owner', startBeat: 10, targetClipId: 'copy' },
            },
            { shouldExecute: expect.any(Function), shouldCommit: expect.any(Function) }
        );
        expect(mocks.select).toHaveBeenCalledExactlyOnceWith('copy');
    });

    it('does not treat a resolved void dispatch as a commit witness', async () => {
        expect(await createPatternInstanceFromSelection()).toBe(false);
        expect(mocks.dispatch).toHaveBeenCalledOnce();
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it('handles a committed post-effect failure without dispatching the creation twice', async () => {
        const failure = new Error('Committed post-effect');
        mocks.isCommitted.mockImplementation((error) => error === failure);
        mocks.dispatch.mockImplementation(async () => {
            publishCopy();
            throw failure;
        });
        expect(await createPatternInstanceFromSelection()).toBe(true);
        expect(mocks.dispatch).toHaveBeenCalledOnce();
        expect(mocks.error).toHaveBeenCalledExactlyOnceWith(failure);
        expect(mocks.select).toHaveBeenCalledExactlyOnceWith('copy');
    });

    it('propagates an uncommitted failure without retry or selection', async () => {
        const failure = new Error('Not committed');
        mocks.dispatch.mockRejectedValue(failure);
        await expect(createPatternInstanceFromSelection()).rejects.toBe(failure);
        expect(mocks.dispatch).toHaveBeenCalledOnce();
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it('cannot select a same-ID copy in a replacement project after dispatch settles', async () => {
        mocks.dispatch.mockImplementation(async () => {
            publishCopy();
            mocks.project.id = 'replacement';
        });
        expect(await createPatternInstanceFromSelection()).toBe(false);
        expect(mocks.select).not.toHaveBeenCalled();
    });
});
