import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { type AppAction, type DeviceSnapshot, type HandlerValidationContext } from '#/utils/handlerContract';

import {
    type DeviceChainRuntimeDeltaDischarged,
    type DeviceChainRuntimeDeltaSuperseded,
} from '../../../useCases/device/applyDeviceChainRuntimeDelta';
import { handleLoadPreset } from '../handleLoadPreset';

const mocks = vi.hoisted(() => ({
    applyDeviceChainRuntimeDelta: vi.fn(),
    captureProjectRevision: vi.fn(() => 'project-1'),
    findPresetById: vi.fn(),
    getTrackStrip: vi.fn<() => unknown>(() => ({})),
    hasLiveProjectHostTrack: vi.fn(() => true),
    getTrackStoreState: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesMaterializedPresetDevices: vi.fn(() => true),
    updateDeviceParam: vi.fn(),
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    createRuntimeGraphTopologyFingerprint: (node: unknown) => JSON.stringify(node),
    getRuntimeGraphRevision: vi.fn(() => 4),
    getTrackStrip: mocks.getTrackStrip,
    initializeTrackStripFromSnapshot: mocks.initializeTrackStripFromSnapshot,
    resolveToasterPadBinding: vi.fn(() => undefined),
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('../../../useCases/device/hasLiveProjectHostTrack', () => ({
    hasLiveProjectHostTrack: mocks.hasLiveProjectHostTrack,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/preset/findPresetById', () => ({
    findPresetById: mocks.findPresetById,
}));

vi.mock('../../../useCases/preset/matchesMaterializedPresetDevices', () => ({
    matchesMaterializedPresetDevices: mocks.matchesMaterializedPresetDevices,
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

type LoadPresetAction = Extract<AppAction, { type: 'loadPreset' }>;

/**
 * What the delta reports once its host track left project truth mid-commit.
 * Typed against the production variant so a fixture cannot describe an outcome
 * the union does not carry.
 */
const supersededPresetDelta: DeviceChainRuntimeDeltaSuperseded = {
    acceptance: 'superseded',
    application: 'not-applied',
    reason: 'Track track-1 left project truth before its replace-device-chain delta was submitted',
};

const dischargedPresetDelta: DeviceChainRuntimeDeltaDischarged = {
    acceptance: 'superseded',
    application: 'discharged',
    reason: 'Live runtime already matches the authoritative final device chain for track track-1',
};

const oldDevice: DeviceSnapshot = {
    id: 'old-device',
    name: 'Old',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: {},
};
const newDevice: DeviceSnapshot = {
    id: 'preset-device-1',
    name: 'Poly',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: { cutoff: 0.6 },
};

function action(overrides: Partial<LoadPresetAction['payload']> = {}): LoadPresetAction {
    return {
        type: 'loadPreset' as const,
        payload: {
            presetId: 'preset-1',
            trackId: 'track-1',
            expectedBefore: {
                id: 'track-1',
                kind: 'midi' as const,
                devices: [{ id: 'old-device', type: 'builtin-synth', parameterIds: [] }],
            },
            expectedProjectRevision: 'project-1',
            expectedFrozen: false,
            devices: [newDevice],
            ...overrides,
        },
    };
}

function validate(actionToValidate: LoadPresetAction, context?: HandlerValidationContext): boolean {
    const handlerValidate = handleLoadPreset.validate;
    if (!handlerValidate) {
        throw new Error('loadPreset handler is missing authoritative validation');
    }
    return handlerValidate(actionToValidate, context ?? { actions: [actionToValidate], actionIndex: 0 });
}

describe('handleLoadPreset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        mocks.captureProjectRevision.mockReturnValue('project-1');
        mocks.getTrackStrip.mockReturnValue({});
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }],
        });
        mocks.findPresetById.mockReturnValue({ id: 'preset-1', name: 'Glass Pad' });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 4, projectRevision: 'project-2' },
            runtimeRevision: 5,
        });
        mocks.initializeTrackStripFromSnapshot.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 4, projectRevision: 'project-2' },
            runtimeRevision: 5,
        });
    });

    it('writes the catalog-owned project chain before applying its runtime delta and parameters', async () => {
        const result = await handleLoadPreset.execute(action());

        expect(result).toMatchObject({ status: 'written' });
        expect(mocks.updateTrack).toHaveBeenCalledOnce();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        if (!result || result.status !== 'written') {
            throw new Error('Preset load did not produce a project write');
        }

        const afterCommit = result.afterCommit;
        if (!afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }
        await afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith({
            before: expect.objectContaining({ id: 'track-1', devices: [oldDevice] }),
            after: expect.objectContaining({ id: 'track-1', devices: [newDevice] }),
            operation: 'replace-device-chain',
        });
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'preset-device-1', 'cutoff', 0.6);
        expect(mocks.applyDeviceChainRuntimeDelta.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.updateDeviceParam.mock.invocationCallOrder[0]!
        );
    });

    it('surfaces a rejected post-commit runtime receipt and does not apply parameters', async () => {
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'runtime revision stale',
        });
        const result = await handleLoadPreset.execute(action());
        if (!result || result.status !== 'written') {
            throw new Error('Preset load did not produce a project write');
        }

        const afterCommit = result.afterCommit;
        if (!afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }
        await expect(Promise.resolve().then(() => afterCommit())).rejects.toThrow(/requires retry/);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('surfaces a needs-reconcile receipt and does not apply parameters', async () => {
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'failed',
            correlation: { appRevision: 4, projectRevision: 'project-2' },
            runtimeRevision: 5,
            reason: 'graph rebuild failed',
        });
        const result = await handleLoadPreset.execute(action());
        if (!result || result.status !== 'written') {
            throw new Error('Preset load did not produce a project write');
        }

        const afterCommit = result.afterCommit;
        if (!afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }
        await expect(Promise.resolve().then(() => afterCommit())).rejects.toThrow(/requires repair/);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('initializes a missing live strip from the committed replacement snapshot before applying parameters', async () => {
        mocks.getTrackStrip.mockReturnValue(undefined);
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValue({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [newDevice] }] });
        const result = await handleLoadPreset.execute(action());
        if (!result || result.status !== 'written') {
            throw new Error('Preset load did not produce a project write');
        }
        const afterCommit = result.afterCommit;
        if (!afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }

        await afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'initialize-track-strip',
                nodes: [
                    expect.objectContaining({
                        id: 'track-1',
                        devices: [{ id: 'preset-device-1', type: 'builtin-synth', parameterIds: ['cutoff'] }],
                    }),
                ],
            })
        );
        expect(mocks.initializeTrackStripFromSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.updateDeviceParam.mock.invocationCallOrder[0]!
        );
    });

    it('initializes a missing live strip directly from the authoritative final same-track chain', async () => {
        const presetAction = action();
        const finalDevice: DeviceSnapshot = {
            id: 'final-device-1',
            name: 'Final',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        const laterDeviceMutation: AppAction = {
            type: 'restorePresetDeviceChain',
            payload: {
                trackId: 'track-1',
                expectedBefore: {
                    id: 'track-1',
                    kind: 'midi',
                    devices: [{ id: 'preset-device-1', type: 'builtin-synth', parameterIds: ['cutoff'] }],
                },
                expectedFrozen: false,
                replacementDevices: [finalDevice],
            },
        };
        mocks.getTrackStrip.mockReturnValue(undefined);
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValue({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [finalDevice] }] });
        const result = await handleLoadPreset.execute(presetAction, {
            actions: [presetAction, laterDeviceMutation],
            actionIndex: 0,
        });
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }

        await result.afterCommit();

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [
                    expect.objectContaining({
                        id: 'track-1',
                        devices: [{ id: 'final-device-1', type: 'builtin-compressor', parameterIds: ['threshold'] }],
                    }),
                ],
            })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'final-device-1', 'threshold', -12);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalledWith('track-1', 'preset-device-1', 'cutoff', 0.6);
    });

    it('uses the authoritative final same-track chain for parameters on an existing live strip', async () => {
        const presetAction = action();
        const finalDevice: DeviceSnapshot = {
            id: 'final-device-1',
            name: 'Final',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        const laterDeviceMutation: AppAction = {
            type: 'restorePresetDeviceChain',
            payload: {
                trackId: 'track-1',
                expectedBefore: {
                    id: 'track-1',
                    kind: 'midi',
                    devices: [{ id: 'preset-device-1', type: 'builtin-synth', parameterIds: ['cutoff'] }],
                },
                expectedFrozen: false,
                replacementDevices: [finalDevice],
            },
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValue({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [finalDevice] }] });
        const result = await handleLoadPreset.execute(presetAction, {
            actions: [presetAction, laterDeviceMutation],
            actionIndex: 0,
        });
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }

        await result.afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith({
            before: expect.objectContaining({ id: 'track-1', devices: [oldDevice] }),
            after: expect.objectContaining({ id: 'track-1', devices: [newDevice] }),
            operation: 'replace-device-chain',
            batchContext: { actions: [presetAction, laterDeviceMutation], actionIndex: 0 },
        });
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'final-device-1', 'threshold', -12);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalledWith('track-1', 'preset-device-1', 'cutoff', 0.6);
    });

    it('initializes a newly created Toaster folder from its committed after-state, not its empty before-state', async () => {
        mocks.getTrackStrip.mockReturnValue(undefined);
        const toasterDevice: DeviceSnapshot = {
            id: 'toaster-device',
            name: 'Toaster',
            type: 'toaster',
            bypassed: false,
            parameterValues: { masterGain: 1.2 },
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'toaster-folder', kind: 'folder', frozen: false, devices: [] }] })
            .mockReturnValueOnce({ tracks: [{ id: 'toaster-folder', kind: 'folder', frozen: false, devices: [] }] })
            .mockReturnValue({
                tracks: [{ id: 'toaster-folder', kind: 'folder', frozen: false, devices: [toasterDevice] }],
            });
        const toasterAction = action({
            trackId: 'toaster-folder',
            expectedProjectRevision: undefined,
            expectedBefore: { id: 'toaster-folder', kind: 'folder', devices: [] },
            devices: [toasterDevice],
        });

        const result = await handleLoadPreset.execute(toasterAction);
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Toaster preset load did not schedule its post-commit runtime effect');
        }
        await result.afterCommit();

        expect(mocks.initializeTrackStripFromSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [
                    expect.objectContaining({
                        id: 'toaster-folder',
                        kind: 'folder',
                        devices: [{ id: 'toaster-device', type: 'toaster', parameterIds: ['masterGain'] }],
                    }),
                ],
            })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('toaster-folder', 'toaster-device', 'masterGain', 1.2);
    });

    it('rejects a stale collaborator revision before the project write or runtime effect', async () => {
        mocks.captureProjectRevision.mockReturnValue('project-2');

        expect(validate(action())).toBe(false);
        await expect(Promise.resolve(handleLoadPreset.execute(action()))).resolves.toEqual({ status: 'conflict' });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
    });

    it('rejects a malformed duplicate device snapshot before the project write', async () => {
        const malformed = action({ devices: [newDevice, { ...newDevice }] });

        expect(validate(malformed)).toBe(false);
        await expect(Promise.resolve(handleLoadPreset.execute(malformed))).resolves.toEqual({ status: 'conflict' });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('validates the load action against an earlier addTrack in the same guarded batch', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        const planned = action({
            trackId: 'preset-track-1',
            expectedProjectRevision: undefined,
            expectedBefore: {
                id: 'preset-track-1',
                kind: 'midi',
                devices: [{ id: 'preset-initial-device-1', type: 'builtin-synth', parameterIds: [] }],
            },
        });
        const add = {
            type: 'addTrack' as const,
            payload: {
                id: 'preset-track-1',
                initialAlternativeId: 'preset-alternative-1',
                initialDeviceId: 'preset-initial-device-1',
                name: 'Glass Pad',
                kind: 'midi' as const,
            },
        };

        expect(validate(planned, { actions: [add, planned], actionIndex: 1 })).toBe(true);
    });

    it('captures an exact guarded inverse for undo/redo rather than reloading the mutable catalog', () => {
        const description = handleLoadPreset.describe(action());

        expect(description.inverseAction).toMatchObject({
            type: 'restorePresetDeviceChain',
            payload: {
                trackId: 'track-1',
                expectedBefore: {
                    id: 'track-1',
                    kind: 'midi',
                    devices: [{ id: 'preset-device-1', type: 'builtin-synth', parameterIds: ['cutoff'] }],
                },
                replacementDevices: [oldDevice],
            },
        });
    });

    it.each([
        ['rejected', { acceptance: 'rejected', application: 'not-applied', reason: 'runtime revision stale' }, 'retry'],
        [
            'needs-reconcile',
            {
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                correlation: { appRevision: 4, projectRevision: 'project-2' },
                runtimeRevision: 5,
                reason: 'partial graph replacement',
            },
            'repair',
        ],
    ])(
        'does not return clean Command success after a %s runtime receipt',
        async (_label, runtimeResult, remediation) => {
            mocks.applyDeviceChainRuntimeDelta.mockReturnValue(runtimeResult);
            registerHandlerMap({ loadPreset: handleLoadPreset });

            const committedError = await executeAppAction(action()).then(
                () => {
                    throw new Error('Expected committed preset runtime failure');
                },
                (error: unknown) => error
            );

            expect(isAppActionCommittedError(committedError)).toBe(true);
            expect(committedError).toMatchObject({
                cause: expect.any(AggregateError),
            });
            expect(undoStore.value?.past).toHaveLength(1);
            expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
            expect(committedError).toMatchObject({
                message: 'Action committed but post-commit processing failed: loadPreset',
            });
            if (!(committedError instanceof Error) || !(committedError.cause instanceof AggregateError)) {
                throw new Error('Expected the Command receipt to preserve the post-commit failure');
            }
            for (const runtimeFailure of committedError.cause.errors) {
                expect(runtimeFailure).toMatchObject({
                    name: 'RuntimePresetDeltaPostCommitError',
                    outcome: runtimeResult,
                    remediation,
                });
            }
        }
    );

    it('returns clean Command success when the same commit superseded the replacement delta', async () => {
        // The host track left project truth later in this commit, so the chain
        // this preset would install is gone with it.
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(supersededPresetDelta);
        registerHandlerMap({ loadPreset: handleLoadPreset });

        await expect(executeAppAction(action())).resolves.toBeUndefined();

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not write parameters from a discharged intermediate replacement after a later same-track mutation', async () => {
        const finalDevice: DeviceSnapshot = {
            id: 'final-device-1',
            name: 'Final',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { threshold: -12 },
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValue({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [finalDevice] }] });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(dischargedPresetDelta);
        const result = await handleLoadPreset.execute(action());
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }

        await result.afterCommit();

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('writes parameters when a discharged replacement remains authoritative', async () => {
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValueOnce({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [oldDevice] }] })
            .mockReturnValue({ tracks: [{ id: 'track-1', kind: 'midi', frozen: false, devices: [newDevice] }] });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(dischargedPresetDelta);
        const result = await handleLoadPreset.execute(action());
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Preset load did not schedule a post-commit runtime effect');
        }

        await result.afterCommit();

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'preset-device-1', 'cutoff', 0.6);
    });

    it('does not initialize a strip for a track the same commit removed', async () => {
        // The no-live-strip branch never consults project truth, so without its
        // own guard it happily builds a strip for a track that no longer
        // exists — an orphan nothing owns or tears down.
        mocks.getTrackStrip.mockReturnValue(undefined);
        mocks.hasLiveProjectHostTrack.mockReturnValue(false);
        registerHandlerMap({ loadPreset: handleLoadPreset });

        await expect(executeAppAction(action())).resolves.toBeUndefined();

        expect(mocks.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('returns clean Command success only after the runtime replacement applies and parameters follow', async () => {
        registerHandlerMap({ loadPreset: handleLoadPreset });

        await expect(executeAppAction(action())).resolves.toBeUndefined();

        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'preset-device-1', 'cutoff', 0.6);
    });
});
