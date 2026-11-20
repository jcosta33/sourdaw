import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { toToasterKitState } from '../../models/ToasterKitState';
import { getToasterPresetKit } from '../getToasterPresetKit';
import { selectToasterFactoryKit } from '../selectToasterFactoryKit';

const mocks = vi.hoisted(() => ({
    resolve: vi.fn<typeof import('#/modules/Arrangement/stores').resolveEligibleDeviceWriteTarget>(),
    planned: vi.fn<typeof import('#/modules/Arrangement/useCases').getPlannedDevicePatchState>(),
    capture: vi.fn<typeof import('#/modules/Arrangement/useCases').captureDevicePatchCommitValidation>(),
    batch: vi.fn<typeof import('#/modules/Command/useCases').executeAppActionBatch>(),
    notify: vi.fn(),
    error: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mocks.resolve,
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getPlannedDevicePatchState: mocks.planned,
    captureDevicePatchCommitValidation: mocks.capture,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: mocks.batch,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.error } }));

const before = { version: 1, data: { kit: { name: 'Edited kit' }, sibling: { retained: true } } };
const current: NonNullable<ReturnType<typeof mocks.planned>> = {
    kind: 'device',
    trackId: 'track-1',
    deviceId: 'device-1',
    deviceIds: ['other', 'device-1'],
    frozen: false,
    deviceType: DEVICE_TYPE_IDS.toaster,
    state: { deviceState: before, parameterValues: { gain: 0.7 } },
};
const isCurrent = vi.fn(() => true);
const authority: NonNullable<ReturnType<typeof mocks.capture>> = {
    isCurrent,
    matchesCommittedParameters: () => false,
    start: () => null,
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockReturnValue({ status: 'eligible', trackId: 'track-1', deviceId: 'device-1' });
    mocks.planned.mockReturnValue(current);
    mocks.capture.mockReturnValue(authority);
    mocks.batch.mockResolvedValue({ status: 'committed', actions: [] });
});

describe('selectToasterFactoryKit', () => {
    it('captures the selected kit and sibling metadata in one addressed batch with fresh authority', async () => {
        const kit = getToasterPresetKit('808-classic');
        if (!kit) {
            throw new Error('Missing factory kit');
        }
        const replacement = toToasterKitState(kit);
        await selectToasterFactoryKit('device-1', '808-classic');
        await selectToasterFactoryKit('device-1', '808-classic');
        expect(mocks.resolve).toHaveBeenCalledWith('device-1');
        expect(mocks.planned).toHaveBeenCalledWith({ deviceId: 'device-1', trackId: 'track-1', parameterIds: [] });
        expect(mocks.capture).toHaveBeenCalledWith({
            trackId: 'track-1',
            deviceId: 'device-1',
            parameterIds: [],
            requireCurrentProjection: true,
        });
        expect(mocks.batch).toHaveBeenCalledTimes(2);
        expect(mocks.batch).toHaveBeenNthCalledWith(
            1,
            [
                {
                    type: 'setToasterFactoryKit',
                    payload: {
                        deviceId: 'device-1',
                        trackId: 'track-1',
                        deviceIds: ['other', 'device-1'],
                        label: 'Load Sourdough 808',
                        before,
                        after: { ...replacement, data: { ...before.data, ...replacement.data } },
                    },
                },
            ],
            {
                groupId: expect.any(String),
                groupLabel: 'Load Sourdough 808',
                source: 'manual',
                skipMacroRecording: true,
                shouldExecute: isCurrent,
            }
        );
        const [first, second] = mocks.batch.mock.calls;
        expect(first?.[1]?.groupId).not.toBe(second?.[1]?.groupId);
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('ignores an unknown kit', async () => {
        await selectToasterFactoryKit('device-1', 'missing');
        expect(mocks.resolve).not.toHaveBeenCalled();
        expect(mocks.batch).not.toHaveBeenCalled();
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it.each(['missing', 'ineligible'] as const)('warns for an %s target', async (status) => {
        mocks.resolve.mockReturnValue({ status });
        await selectToasterFactoryKit('device-1', '808-classic');
        expect(mocks.planned).not.toHaveBeenCalled();
        expect(mocks.batch).not.toHaveBeenCalled();
        expect(mocks.notify).toHaveBeenCalledWith(
            'Could not load the kit. The Toaster track is frozen or no longer available.',
            'warning'
        );
    });

    it.each([null, { ...current, frozen: true }, { ...current, deviceType: 'another-device' }])(
        'warns when the current target is unavailable, frozen or wrong type',
        async (state) => {
            mocks.planned.mockReturnValue(state);
            await selectToasterFactoryKit('device-1', '808-classic');
            expect(mocks.capture).not.toHaveBeenCalled();
            expect(mocks.batch).not.toHaveBeenCalled();
            expect(mocks.notify).toHaveBeenCalledWith(
                'Could not load the kit. The Toaster track is frozen or no longer available.',
                'warning'
            );
        }
    );

    it('does nothing when the selected kit already matches', async () => {
        const kit = getToasterPresetKit('808-classic');
        if (!kit) {
            throw new Error('Missing factory kit');
        }
        mocks.planned.mockReturnValue({ ...current, state: { ...current.state, deviceState: toToasterKitState(kit) } });
        await selectToasterFactoryKit('device-1', '808-classic');
        expect(mocks.capture).not.toHaveBeenCalled();
        expect(mocks.batch).not.toHaveBeenCalled();
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('warns when commit authority cannot be captured', async () => {
        mocks.capture.mockReturnValue(null);
        await selectToasterFactoryKit('device-1', '808-classic');
        expect(mocks.batch).not.toHaveBeenCalled();
        expect(mocks.notify).toHaveBeenCalledWith('Could not load the kit while the project is changing.', 'warning');
    });

    it('reports a rejected batch', async () => {
        mocks.batch.mockResolvedValue({ status: 'rejected', reason: 'Project locked', actions: [] });
        await selectToasterFactoryKit('device-1', '808-classic');
        expect(mocks.notify).toHaveBeenCalledWith('Could not load Sourdough 808. Project locked', 'warning');
    });

    it('reports and logs a rejected promise', async () => {
        const cause = new Error('transport failure');
        mocks.batch.mockRejectedValue(cause);
        await selectToasterFactoryKit('device-1', '808-classic');
        expect(mocks.notify).toHaveBeenCalledWith('Could not load Sourdough 808.', 'error');
        expect(mocks.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Toaster factory kit selection failed', cause })
        );
    });
});
