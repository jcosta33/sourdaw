import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleCreatePatternInstance } from '../handleCreatePatternInstance';

type StubTrack = {
    id: string;
    kind: string;
    frozen?: boolean;
    clips: { id: string; type: string }[];
    alternatives: { clips: { id: string }[] }[];
};

const mocks = vi.hoisted(() => ({
    trackState: { tracks: [] as StubTrack[], ghostClips: [] as { id: string }[] } as {
        tracks: StubTrack[];
        ghostClips: { id: string }[];
    } | null,
    createPatternInstance:
        vi.fn<
            (sourceClipId: string, targetTrackId: string, startBeat: number, targetClipId: string) => string | null
        >(),
    stamp: vi.fn(),
}));
vi.mock('../../clip/stampCreatedClipStateGuard', () => ({ stampCreatedClipStateGuard: mocks.stamp }));
vi.mock('../../clip/prepareCreatedClipRedoGuard', () => ({ prepareCreatedClipRedoGuard: () => undefined }));
vi.mock('#/modules/Command/useCases', () => ({ commitRedoInverseCapture: vi.fn() }));

vi.mock('../../../useCases/patternInstance/createPatternInstance', () => ({
    createPatternInstance: mocks.createPatternInstance,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: () => mocks.trackState }));

function seedProject(overrides: { sourceType?: string; destinationKind?: string; frozen?: boolean } = {}): void {
    mocks.trackState = {
        tracks: [
            {
                id: 'midi-track',
                kind: overrides.destinationKind ?? 'midi',
                frozen: overrides.frozen,
                clips: [{ id: 'source-clip', type: overrides.sourceType ?? 'midi' }],
                alternatives: [],
            },
        ],
        ghostClips: [],
    };
}

const action: Extract<AppAction, { type: 'createPatternInstance' }> = {
    type: 'createPatternInstance' as const,
    payload: { sourceClipId: 'source-clip', targetTrackId: 'midi-track', startBeat: 16, targetClipId: 'instance-clip' },
};

describe('handleCreatePatternInstance', () => {
    beforeEach(() => {
        mocks.createPatternInstance.mockReset();
        mocks.stamp.mockReset();
        seedProject();
    });

    const context = (candidate: typeof action) => ({ actions: [candidate], actionIndex: 0 });
    const refusalOf = (candidate: typeof action) =>
        handleCreatePatternInstance.validationRefusalReason?.(candidate, context(candidate));

    it.each([
        ['a source clip that does not exist', { sourceClipId: 'ghost' }, undefined, 'Clip "ghost" does not exist'],
        [
            'a source that is not MIDI',
            {},
            { sourceType: 'audio' },
            'Clip "source-clip" is not a MIDI clip, so it has no pattern to instance',
        ],
        ['a destination that does not exist', { targetTrackId: 'ghost' }, undefined, 'Track "ghost" does not exist'],
        [
            'a destination that is not a MIDI track',
            {},
            { destinationKind: 'audio' },
            'Track "midi-track" is not a MIDI track, so it cannot host a pattern instance',
        ],
        ['a frozen destination', {}, { frozen: true }, 'Track "midi-track" is frozen'],
        ['a negative start beat', { startBeat: -1 }, undefined, 'The start beat must be a finite, non-negative beat'],
        [
            'a non-finite start beat',
            { startBeat: Number.NaN },
            undefined,
            'The start beat must be a finite, non-negative beat',
        ],
        ['an empty target id', { targetClipId: '' }, undefined, 'The instance clip ID must not be empty'],
        ['a blank target id', { targetClipId: '   ' }, undefined, 'The instance clip ID must not be empty'],
        ['a target id already in use', { targetClipId: 'source-clip' }, undefined, 'Clip "source-clip" already exists'],
    ])('refuses %s', (_name, payload, project, reason) => {
        seedProject(project);
        const refused = { ...action, payload: { ...action.payload, ...payload } };

        expect(handleCreatePatternInstance.validate?.(refused, context(refused))).toBe(false);
        expect(refusalOf(refused)).toBe(reason);
    });

    it('admits a valid instance and describes no inverse for a missing source', () => {
        expect(handleCreatePatternInstance.validate?.(action, context(action))).toBe(true);

        const missing = { ...action, payload: { ...action.payload, sourceClipId: 'ghost' } };
        expect(handleCreatePatternInstance.describe(missing)).toEqual({
            label: 'Create Pattern Instance',
            inverseAction: null,
        });
    });

    it('returns written synchronously only when an instance was created', () => {
        mocks.createPatternInstance.mockReturnValue('instance-clip');

        const result = handleCreatePatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'written' });
        expect(mocks.createPatternInstance).toHaveBeenCalledWith('source-clip', 'midi-track', 16, 'instance-clip');
        expect(handleCreatePatternInstance.undoable).toBe(true);
        expect(handleCreatePatternInstance.describe(action)).toMatchObject({
            label: 'Create Pattern Instance',
            inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: 'instance-clip' } },
        });
        expect(mocks.stamp).toHaveBeenCalledOnce();
    });

    it('returns no-write synchronously when creation is rejected', () => {
        mocks.createPatternInstance.mockReturnValue(null);

        const result = handleCreatePatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.createPatternInstance).toHaveBeenCalledOnce();
        expect(mocks.stamp).not.toHaveBeenCalled();
    });

    it('materializes one canonical identity before description and preserves singleton preview admission', () => {
        const requested: Extract<AppAction, { type: 'createPatternInstance' }> = {
            type: 'createPatternInstance',
            payload: { sourceClipId: 'source-clip', targetTrackId: 'midi-track', startBeat: 16 },
        };
        handleCreatePatternInstance.materializeCommandArguments?.(requested);
        const targetClipId = requested.payload.targetClipId;
        expect(targetClipId).toMatch(/^clip-inst-/);
        handleCreatePatternInstance.materializeCommandArguments?.(requested);
        expect(requested.payload.targetClipId).toBe(targetClipId);
        expect(handleCreatePatternInstance.describe(requested)).toMatchObject({
            inverseAction: { payload: { clipId: targetClipId } },
        });
        expect(handleCreatePatternInstance.batchExecution).toBe('singleton');
        expect(handleCreatePatternInstance.previewExecution).toBeUndefined();
    });
});
