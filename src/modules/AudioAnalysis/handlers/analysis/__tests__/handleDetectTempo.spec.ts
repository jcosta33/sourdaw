import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDetectTempo } from '../handleDetectTempo';

type TestTrackState = {
    tracks: Array<{ clips: Array<{ id: string; audioBufferId?: string }> }>;
};

const mocks = vi.hoisted(() => {
    const trackStore: { value: TestTrackState } = { value: { tracks: [] } };
    return {
        detectTempoFromBuffer: vi.fn(),
        detectProjectTempo: vi.fn(),
        executeAppAction: vi.fn(),
        trackStore,
        notifyUser: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    detectProjectTempo: mocks.detectProjectTempo,
}));

vi.mock('../../../useCases/tempoDetection', () => ({
    detectTempo: mocks.detectTempoFromBuffer,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleDetectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeAppAction.mockReset();
        mocks.trackStore.value = { tracks: [] };
    });

    it('should detect tempo from a specific clip buffer if available', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        };
        mocks.detectTempoFromBuffer.mockReturnValue(125);

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.detectTempoFromBuffer).toHaveBeenCalledWith('buf1');
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected tempo: 125 BPM');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('should notify failure if buffer tempo detection returns null', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        };
        mocks.detectTempoFromBuffer.mockReturnValue(null);

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Could not detect tempo');
    });

    it('dispatches a base-tempo action before reporting a confident project result', async () => {
        mocks.trackStore.value = { tracks: [{ clips: [{ id: 'c1' }] }] };
        mocks.detectProjectTempo.mockReturnValue({
            averageBpm: 128.4,
            minBpm: 110,
            maxBpm: 130,
            confidence: 0.8,
            normalizedBpm: 128,
        });
        let releaseWrite!: () => void;
        mocks.executeAppAction.mockImplementation(() => new Promise<void>((resolve) => (releaseWrite = resolve)));

        const execution = handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.detectProjectTempo).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setTempo', payload: { bpm: 128, tempoChangeId: null } },
            expect.any(Object)
        );
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        releaseWrite();
        await execution;
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected tempo: 128.4 BPM (110–130 range)', 'success');
    });

    it('clamps a confident detected base tempo without naming a map event or legacy replay expectation', async () => {
        mocks.detectProjectTempo.mockReturnValue({
            averageBpm: 401,
            minBpm: 390,
            maxBpm: 410,
            confidence: 0.9,
            normalizedBpm: 300,
        });

        await handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'missing' } });

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setTempo', payload: { bpm: 300, tempoChangeId: null } },
            expect.any(Object)
        );
    });

    it('forwards the caller cancellation and work context to the child action', async () => {
        const controller = new AbortController();
        const onDeferredEffectAttempt = vi.fn();
        mocks.detectProjectTempo.mockReturnValue({
            averageBpm: 140,
            minBpm: 140,
            maxBpm: 140,
            confidence: 1,
            normalizedBpm: 140,
        });
        const action = { type: 'detectTempo', payload: { clipId: 'missing' } } as const;

        await handleDetectTempo.execute(action, {
            actions: [action],
            actionIndex: 0,
            signal: controller.signal,
            onDeferredEffectAttempt,
            workOwner: null,
        });

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setTempo', payload: { bpm: 140, tempoChangeId: null } },
            expect.objectContaining({
                signal: controller.signal,
                onDeferredEffectAttempt,
                workOwner: null,
                shouldExecute: expect.any(Function),
            })
        );
        const options = mocks.executeAppAction.mock.calls[0]?.[1] as { shouldExecute: () => boolean };
        expect(options.shouldExecute()).toBe(true);
        controller.abort();
        expect(options.shouldExecute()).toBe(false);
    });

    it('should warn without dispatching a write if project tempo confidence is too low', async () => {
        mocks.trackStore.value = { tracks: [{ clips: [{ id: 'c1' }] }] };
        mocks.detectProjectTempo.mockReturnValue({
            averageBpm: 120,
            minBpm: 110,
            maxBpm: 130,
            confidence: 0.3,
            normalizedBpm: null,
        });

        await handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Could not confidently detect tempo — add more content first',
            'warning'
        );
    });

    it('should provide a description', () => {
        const description = handleDetectTempo.describe({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(description.label).toBe('Detect tempo');
    });

    it('does not add an outer undo entry for an admitted setTempo child', () => {
        expect(handleDetectTempo.undoable).toBe(false);
    });

    it('is a runtime orchestrator so its child project action owns the write and undo entry', () => {
        expect(handleDetectTempo.executionKind).toBe('runtime');
    });
});
