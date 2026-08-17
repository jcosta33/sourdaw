import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { type AppAction, type DeviceSnapshot, type HandlerValidationContext } from '#/utils/handlerContract';

import { handleLoadPreset } from '../handleLoadPreset';

const mocks = vi.hoisted(() => ({
    applyDeviceChainRuntimeDelta: vi.fn(),
    captureProjectRevision: vi.fn(() => 'project-1'),
    findPresetById: vi.fn(),
    getTrackStrip: vi.fn<() => unknown>(() => ({})),
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

    it('returns clean Command success only after the runtime replacement applies and parameters follow', async () => {
        registerHandlerMap({ loadPreset: handleLoadPreset });

        await expect(executeAppAction(action())).resolves.toBeUndefined();

        expect(undoStore.value?.past).toHaveLength(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('track-1', 'preset-device-1', 'cutoff', 0.6);
    });
});
