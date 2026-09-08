import { beforeEach, describe, expect, it, vi } from 'vitest';

import { capturedNativePluginStateCache } from '../capturedNativePluginStateCache';
import { captureExternalPluginStates } from '../captureExternalPluginStates';
import { warnedExternalPluginCaptureRejections } from '../warnedExternalPluginCaptureRejections';

type MockDevice = {
    id: string;
    name: string;
    type: string;
    externalInstanceId?: string;
    externalStateChunk?: string;
    externalPluginId?: string;
};

type BatchOptions = {
    authorizeFirstHandler?: () => string | null;
    shouldExecute?: () => boolean;
};

const tokens = {
    alpha: Object.freeze({ token: 'alpha' }),
    beta: Object.freeze({ token: 'beta' }),
    gamma: Object.freeze({ token: 'gamma' }),
};

const mocks = vi.hoisted(() => ({
    trackStore: { value: null as { tracks: { id: string; devices: MockDevice[] }[] } | null },
    executeAppActionBatch: vi.fn<(actions: unknown[], options?: BatchOptions) => Promise<{ status: string }>>(),
    captureProjectRevision: vi.fn<() => string>(),
    captureProjectMutationAuthorization: vi.fn<() => () => boolean>(),
    readExternalPluginStateForCapture: vi.fn<(instanceId: string) => Promise<unknown>>(),
    hasUnresolvedExternalPluginRestoreFailure: vi.fn<(instanceId: string) => boolean>(),
    shouldWarnExternalPluginRestoreFailure: vi.fn<(instanceId: string) => boolean>(),
    notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppActionBatch: mocks.executeAppActionBatch }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    captureProjectMutationAuthorization: mocks.captureProjectMutationAuthorization,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    readExternalPluginStateForCapture: mocks.readExternalPluginStateForCapture,
    hasUnresolvedExternalPluginRestoreFailure: mocks.hasUnresolvedExternalPluginRestoreFailure,
    shouldWarnExternalPluginRestoreFailure: mocks.shouldWarnExternalPluginRestoreFailure,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

function device(extra: Partial<MockDevice> = {}): MockDevice {
    return {
        id: 'd1',
        name: 'Serum',
        type: 'external-plugin',
        externalInstanceId: 'inst-1',
        ...extra,
    };
}

function setTrackDevices(devices: MockDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: 't1', devices }] };
}

function captured(stateChunk: string, authorityToken: object = tokens.alpha, isCurrent = () => true) {
    return { status: 'captured' as const, stateChunk, authorityToken, isCurrent };
}

async function executeCommitted(_actions: unknown[], options?: BatchOptions): Promise<{ status: string }> {
    if (options?.shouldExecute && !options.shouldExecute()) {
        return { status: 'cancelled' };
    }
    const refusal = options?.authorizeFirstHandler?.();
    if (refusal) {
        return { status: 'rejected' };
    }
    if (options?.shouldExecute && !options.shouldExecute()) {
        return { status: 'failed' };
    }
    return { status: 'committed' };
}

describe('captureExternalPluginStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
        mocks.executeAppActionBatch.mockImplementation(executeCommitted);
        mocks.captureProjectRevision.mockReturnValue('revision-1');
        mocks.captureProjectMutationAuthorization.mockReturnValue(() => true);
        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('fresh'));
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(false);
        mocks.shouldWarnExternalPluginRestoreFailure.mockReturnValue(false);
        capturedNativePluginStateCache.clear();
        warnedExternalPluginCaptureRejections.clear();
    });

    it('commits fresh host state with strict capture intent and bound authority callbacks', async () => {
        setTrackDevices([device({ externalStateChunk: 'original' })]);
        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('fresh'));

        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: [] });

        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith(
            [
                {
                    type: 'setExternalPluginState',
                    payload: {
                        intent: 'capture',
                        deviceId: 'd1',
                        stateChunk: 'fresh',
                        expectedInstanceId: 'inst-1',
                        expectedStateChunk: 'original',
                    },
                },
            ],
            expect.objectContaining({
                groupLabel: 'Capture plugin state',
                skipMacroRecording: true,
                authorizeFirstHandler: expect.any(Function),
                shouldExecute: expect.any(Function),
            })
        );
        expect(capturedNativePluginStateCache.get('inst-1')).toEqual({
            stateChunk: 'fresh',
            authorityToken: tokens.alpha,
        });
    });

    it.each(['not-loaded', 'empty', 'read-failed', 'restore-pending'] as const)(
        'preserves without dispatch for %s',
        async (reason) => {
            setTrackDevices([device({ externalStateChunk: 'original' })]);
            mocks.readExternalPluginStateForCapture.mockResolvedValue({ status: 'preserve', reason });

            await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: [] });

            expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
            expect(capturedNativePluginStateCache).toHaveLength(0);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        }
    );

    it('warns once per restore-failure episode and never dispatches defaults', async () => {
        setTrackDevices([device({ externalStateChunk: 'original', externalPluginId: 'serum' })]);
        mocks.readExternalPluginStateForCapture.mockResolvedValue({ status: 'preserve', reason: 'restore-failed' });
        mocks.shouldWarnExternalPluginRestoreFailure.mockReturnValueOnce(true).mockReturnValue(false);

        await captureExternalPluginStates();
        await captureExternalPluginStates();

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('preserved'), 'warning');
    });

    it('seeds the tokenized cache on a store-equal read and avoids collaboration ping-pong', async () => {
        const current = device({ externalStateChunk: 'same' });
        setTrackDevices([current]);
        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('same'));

        await captureExternalPluginStates();
        expect(capturedNativePluginStateCache.get('inst-1')).toEqual({
            stateChunk: 'same',
            authorityToken: tokens.alpha,
        });

        current.externalStateChunk = 'peer-state';
        await captureExternalPluginStates();

        expect(mocks.readExternalPluginStateForCapture).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('does not inherit an accepted cache entry across a lifecycle token change', async () => {
        const current = device({ externalStateChunk: 'peer-state' });
        setTrackDevices([current]);
        capturedNativePluginStateCache.set('inst-1', { stateChunk: 'local-state', authorityToken: tokens.alpha });
        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('local-state', tokens.beta));

        await captureExternalPluginStates();

        expect(mocks.executeAppActionBatch).toHaveBeenCalledOnce();
        expect(capturedNativePluginStateCache.get('inst-1')).toEqual({
            stateChunk: 'local-state',
            authorityToken: tokens.beta,
        });
    });

    it('captures again when the local host state genuinely changes', async () => {
        const current = device();
        setTrackDevices([current]);
        mocks.readExternalPluginStateForCapture
            .mockResolvedValueOnce(captured('edit-a'))
            .mockResolvedValueOnce(captured('edit-b'));

        await captureExternalPluginStates();
        current.externalStateChunk = 'edit-a';
        await captureExternalPluginStates();

        expect(mocks.executeAppActionBatch).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppActionBatch.mock.calls[1]?.[0]).toEqual([
            {
                type: 'setExternalPluginState',
                payload: {
                    intent: 'capture',
                    deviceId: 'd1',
                    stateChunk: 'edit-b',
                    expectedInstanceId: 'inst-1',
                    expectedStateChunk: 'edit-a',
                },
            },
        ]);
    });

    it.each(['committed', 'committed-with-warning', 'ambiguous'])(
        'accepts %s as published project truth',
        async (status) => {
            setTrackDevices([device()]);
            mocks.executeAppActionBatch.mockResolvedValue({ status });

            await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: [] });

            expect(capturedNativePluginStateCache.get('inst-1')).toEqual({
                stateChunk: 'fresh',
                authorityToken: tokens.alpha,
            });
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        }
    );

    it.each(['no-op', 'conflicted', 'rejected', 'cancelled', 'failed'])(
        'keeps cache stale and reports %s as rejected',
        async (status) => {
            setTrackDevices([device({ externalPluginId: 'serum' })]);
            mocks.executeAppActionBatch.mockResolvedValue({ status });

            await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: ['serum'] });

            expect(capturedNativePluginStateCache).toHaveLength(0);
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        }
    );

    it('reclassifies a nonaccepted commit as restore preservation when a marker appeared', async () => {
        setTrackDevices([device({ externalPluginId: 'serum', externalStateChunk: 'original' })]);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'failed' });
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);
        mocks.shouldWarnExternalPluginRestoreFailure.mockReturnValue(true);

        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: [] });

        expect(capturedNativePluginStateCache).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('preserved'), 'warning');
    });

    it('suppresses rejection warnings for one token and warns for a new generation', async () => {
        setTrackDevices([device({ externalPluginId: 'serum' })]);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'failed' });

        await captureExternalPluginStates();
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);

        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('fresh', tokens.beta));
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(2);

        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed' });
        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('accepted', tokens.beta));
        await captureExternalPluginStates();

        mocks.executeAppActionBatch.mockResolvedValue({ status: 'failed' });
        mocks.readExternalPluginStateForCapture.mockResolvedValue(captured('later', tokens.beta));
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(3);
    });

    it('keys a stale-read warning to the current token without accepting bytes', async () => {
        setTrackDevices([device({ externalPluginId: 'serum' })]);
        mocks.readExternalPluginStateForCapture.mockResolvedValue({
            status: 'stale',
            authorityToken: tokens.gamma,
        });

        await captureExternalPluginStates();
        await captureExternalPluginStates();

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(capturedNativePluginStateCache).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('rejects when the project revision changes while the host read is pending', async () => {
        setTrackDevices([device({ externalPluginId: 'serum' })]);
        mocks.captureProjectRevision.mockReturnValueOnce('revision-1').mockReturnValue('revision-2');

        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: ['serum'] });

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(capturedNativePluginStateCache).toHaveLength(0);
    });

    it('rejects when the exact device witness changes before dispatch', async () => {
        const current = device({ externalPluginId: 'serum', externalStateChunk: 'original' });
        setTrackDevices([current]);
        mocks.readExternalPluginStateForCapture.mockImplementation(async () => {
            current.externalInstanceId = 'replacement-instance';
            return captured('fresh');
        });

        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: ['serum'] });

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('keeps the cache stale when bound mutation authority is revoked at final execution', async () => {
        setTrackDevices([device({ externalPluginId: 'serum' })]);
        let checks = 0;
        mocks.captureProjectMutationAuthorization.mockReturnValue(() => {
            checks += 1;
            return checks < 2;
        });

        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: ['serum'] });

        expect(mocks.executeAppActionBatch).toHaveBeenCalledOnce();
        expect(capturedNativePluginStateCache).toHaveLength(0);
    });

    it('ignores built-ins, missing instance ids, and a missing live project', async () => {
        setTrackDevices([
            device({ id: 'builtin', type: 'builtin-synth', externalInstanceId: undefined }),
            device({ id: 'no-instance', externalInstanceId: undefined }),
        ]);
        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: [] });

        mocks.trackStore.value = null;
        await expect(captureExternalPluginStates()).resolves.toEqual({ rejectedPlugins: [] });

        expect(mocks.readExternalPluginStateForCapture).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });
});
