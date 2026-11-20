import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    class ConflictError extends Error {}
    class AdmissionRefusedError extends ConflictError {}
    return {
        ConflictError,
        AdmissionRefusedError,
        executeAppAction: vi.fn<typeof import('#/modules/Command/useCases').executeAppAction>(),
        captureDevicePatchCommitValidation: vi.fn(),
        isCurrent: vi.fn(),
        trackStore: {
            value: {
                tracks: [{ id: 'piano', devices: [{ id: 'grand-1', type: 'grand-boule', deviceState: undefined }] }],
            },
        },
        reconcile: vi.fn(),
        notifyUser: vi.fn(),
        logError: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
    describeAppActionRefusal: (actionType: string) => `${actionType} was refused because the project can't be changed`,
    isAppActionAdmissionRefusal: (error: unknown) => error instanceof mocks.AdmissionRefusedError,
    isAppActionConflictError: (error: unknown) => error instanceof mocks.ConflictError,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    captureDevicePatchCommitValidation: mocks.captureDevicePatchCommitValidation,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.logError } }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { commitGrandBouleDeviceState } from '../commitGrandBouleDeviceState';

const edited = {
    morph: {
        modelA: 'mellow-grand',
        modelB: 'singing-grand',
        morphPosition: 0.4,
        layerBalance: 0.2,
        enabled: true,
    },
    temperament: 3,
    parameters: { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 },
} as const;

/** Resolves once every microtask queued so far has run. */
const afterMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('commitGrandBouleDeviceState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isCurrent.mockReturnValue(true);
        mocks.captureDevicePatchCommitValidation.mockReturnValue({ isCurrent: mocks.isCurrent });
    });

    it('captures the owning track and missing chunk through the undoable action', () => {
        mocks.executeAppAction.mockResolvedValue(undefined);
        commitGrandBouleDeviceState('grand-1', edited);

        expect(mocks.captureDevicePatchCommitValidation).toHaveBeenCalledExactlyOnceWith({
            deviceId: 'grand-1',
            trackId: 'piano',
            parameterIds: [],
            requireCurrentProjection: true,
        });
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            {
                type: 'setGrandBouleDeviceState',
                payload: {
                    deviceId: 'grand-1',
                    trackId: 'piano',
                    before: null,
                    after: {
                        version: 1,
                        data: {
                            modelA: 'mellow-grand',
                            modelB: 'singing-grand',
                            morphPosition: 0.4,
                            layerBalance: 0.2,
                            enabled: true,
                            temperament: 3,
                            hammerHardness: 0.4,
                            velocityCurve: 0.85,
                            stereoWidth: 0.7,
                            toneTilt: 0.35,
                        },
                    },
                },
            },
            { authorizeFirstHandler: expect.any(Function) }
        );
        const authorize = mocks.executeAppAction.mock.calls[0]?.[1]?.authorizeFirstHandler;
        expect(authorize?.()).toBeNull();
        mocks.isCurrent.mockReturnValue(false);
        expect(authorize?.()).toBe('Grand Boule changed before the edit began');
    });

    it('leaves the session and says nothing when the edit commits', async () => {
        mocks.executeAppAction.mockResolvedValue(undefined);
        commitGrandBouleDeviceState('grand-1', edited);
        await afterMicrotasks();

        expect(mocks.reconcile).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.logError).not.toHaveBeenCalled();
    });

    it('snaps back and tells the person why when the project refuses the edit', async () => {
        mocks.executeAppAction.mockRejectedValue(new mocks.AdmissionRefusedError('locked'));
        commitGrandBouleDeviceState('grand-1', edited);
        await afterMicrotasks();

        expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('grand-1');
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            "setGrandBouleDeviceState was refused because the project can't be changed",
            'warning'
        );
        expect(mocks.logError).not.toHaveBeenCalled();
    });

    it('snaps back to the newer document state without a notice when the handler reports a conflict', async () => {
        mocks.executeAppAction.mockRejectedValue(new mocks.ConflictError('document moved'));
        commitGrandBouleDeviceState('grand-1', edited);
        await afterMicrotasks();

        expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('grand-1');
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.logError).not.toHaveBeenCalled();
    });

    it('snaps back and logs a failure that is not a conflict', async () => {
        const failure = new Error('storage unavailable');
        mocks.executeAppAction.mockRejectedValue(failure);
        commitGrandBouleDeviceState('grand-1', edited);
        await afterMicrotasks();

        expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('grand-1');
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.logError).toHaveBeenCalledOnce();
        expect(mocks.logError.mock.calls[0]?.[0]).toMatchObject({ cause: failure });
    });
});
