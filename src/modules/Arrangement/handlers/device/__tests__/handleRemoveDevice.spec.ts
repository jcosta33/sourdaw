import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type HandlerValidationContext } from '#/utils/handlerContract';

import { handleRemoveDevice } from '../handleRemoveDevice';

const mocks = vi.hoisted(() => ({
    prepareRemoveDevice: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/device/prepareRemoveDevice', () => ({
    prepareRemoveDevice: mocks.prepareRemoveDevice,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleRemoveDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['written', { status: 'written' }],
        ['missing', { status: 'no-write' }],
        ['conflict', { status: 'conflict' }],
    ] as const)('maps the %s outcome to the handler result', (outcome, expected) => {
        const action = { type: 'removeDevice', payload: { deviceId: 'd1' } } as const;
        const context = { actionIndex: 0, actions: [action] } satisfies HandlerValidationContext;
        mocks.prepareRemoveDevice.mockReturnValue(outcome);

        const result = handleRemoveDevice.execute(action, context);

        expect(mocks.prepareRemoveDevice).toHaveBeenCalledWith('d1', context);
        expect(result).toEqual(expected);
    });

    it('defers external unload until commit and preserves ambiguous-commit reconciliation', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.prepareRemoveDevice.mockReturnValue({ outcome: 'written', afterCommit, afterAmbiguousCommit });

        const result = handleRemoveDevice.execute({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });

        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });

    it('provides a description', () => {
        const desc = handleRemoveDevice.describe({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });
        expect(desc.label).toBe('Remove device');
    });

    it('snapshots the exact device and chain index for undo', () => {
        const device = {
            id: 'd1',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: true,
            parameterValues: { frequency: 2400 },
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'before' }, device, { id: 'after' }] }],
        });

        const desc = handleRemoveDevice.describe({ type: 'removeDevice', payload: { deviceId: 'd1' } });

        expect(desc.inverseAction).toEqual({
            type: 'restoreDevice',
            payload: {
                trackId: 't1',
                deviceSnapshot: device,
                deviceIndex: 1,
                expectedDeviceIds: ['before', 'after'],
            },
        });
    });

    it('is undoable', () => {
        expect(handleRemoveDevice.undoable).toBe(true);
        expect(handleRemoveDevice.requiresAbortCompensation).toBe(false);
    });

    describe('freeze guard', () => {
        function chainWith(frozen: boolean) {
            return { tracks: [{ id: 't1', frozen, devices: [{ id: 'd1' }] }] };
        }
        const planned = {
            type: 'removeDevice',
            payload: { deviceId: 'd1', expectedFrozen: false },
        } as const;

        it('conflicts without touching the chain when the track froze after planning', () => {
            mocks.getTrackStoreState.mockReturnValue(chainWith(true));

            expect(handleRemoveDevice.execute(planned, { actionIndex: 0, actions: [planned] })).toEqual({
                status: 'conflict',
            });
            expect(mocks.prepareRemoveDevice).not.toHaveBeenCalled();
        });

        it('conflicts a redo that replays the removal after the track froze', () => {
            mocks.getTrackStoreState.mockReturnValue(chainWith(false));
            mocks.prepareRemoveDevice.mockReturnValue('written');
            expect(handleRemoveDevice.execute(planned)).toEqual({ status: 'written' });
            mocks.getTrackStoreState.mockReturnValue(chainWith(true));
            mocks.prepareRemoveDevice.mockClear();

            expect(handleRemoveDevice.execute(planned)).toEqual({ status: 'conflict' });
            expect(mocks.prepareRemoveDevice).not.toHaveBeenCalled();
        });

        it('conflicts when the recorded frozen state differs from the live one in either direction', () => {
            mocks.getTrackStoreState.mockReturnValue(chainWith(false));
            const expectsFrozen = { type: 'removeDevice', payload: { deviceId: 'd1', expectedFrozen: true } } as const;

            expect(handleRemoveDevice.execute(expectsFrozen)).toEqual({ status: 'conflict' });
            expect(mocks.prepareRemoveDevice).not.toHaveBeenCalled();
        });

        it('rejects validation when the live freeze state differs from the planned one', () => {
            mocks.getTrackStoreState.mockReturnValue(chainWith(true));

            expect(handleRemoveDevice.validate?.(planned, { actionIndex: 0, actions: [planned] })).toBe(false);
        });

        describe('a device only an earlier batch member adds', () => {
            const addsDevice = {
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'builtin-eq', deviceId: 'batch-device' },
            } as const;
            const removesIt = {
                type: 'removeDevice',
                payload: { deviceId: 'batch-device', expectedFrozen: false },
            } as const;
            const context = { actionIndex: 1, actions: [addsDevice, removesIt] } satisfies HandlerValidationContext;

            it('validates the stamped removal while the planned track is unfrozen', () => {
                mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', frozen: false, devices: [] }] });

                expect(handleRemoveDevice.validate?.(removesIt, context)).toBe(true);
            });

            it('rejects the stamped removal when the planned track is frozen', () => {
                mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', frozen: true, devices: [] }] });

                expect(handleRemoveDevice.validate?.(removesIt, context)).toBe(false);
            });
        });

        describe('a track and device only earlier batch members create', () => {
            const addsTrack = { type: 'addTrack', payload: { id: 'batch-track', kind: 'audio' } } as const;
            const addsDevice = {
                type: 'addDevice',
                payload: { trackId: 'batch-track', deviceType: 'builtin-eq', deviceId: 'batch-device' },
            } as const;
            const removesIt = {
                type: 'removeDevice',
                payload: { deviceId: 'batch-device', expectedFrozen: false },
            } as const;
            const freezes = { type: 'freezeTrack', payload: { trackId: 'batch-track' } } as const;

            it('validates the stamped removal while the planned track is unfrozen', () => {
                mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

                expect(
                    handleRemoveDevice.validate?.(removesIt, {
                        actionIndex: 2,
                        actions: [addsTrack, addsDevice, removesIt],
                    })
                ).toBe(true);
            });

            it('rejects the stamped removal when the planned track is frozen', () => {
                mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

                expect(
                    handleRemoveDevice.validate?.(removesIt, {
                        actionIndex: 3,
                        actions: [addsTrack, addsDevice, freezes, removesIt],
                    })
                ).toBe(false);
            });
        });

        describe('a freeze change an earlier batch member makes', () => {
            const unfreezes = { type: 'unfreezeTrack', payload: { trackId: 't1' } } as const;
            const freezes = { type: 'freezeTrack', payload: { trackId: 't1' } } as const;
            const removesUnfrozen = {
                type: 'removeDevice',
                payload: { deviceId: 'd1', expectedFrozen: false },
            } as const;
            const removesFrozen = { type: 'removeDevice', payload: { deviceId: 'd1', expectedFrozen: true } } as const;

            it('validates a removal stamped unfrozen after an unfreeze of a frozen track', () => {
                mocks.getTrackStoreState.mockReturnValue(chainWith(true));

                expect(
                    handleRemoveDevice.validate?.(removesUnfrozen, {
                        actionIndex: 1,
                        actions: [unfreezes, removesUnfrozen],
                    })
                ).toBe(true);
            });

            it('validates a removal stamped frozen after a freeze of an unfrozen track', () => {
                mocks.getTrackStoreState.mockReturnValue(chainWith(false));

                expect(
                    handleRemoveDevice.validate?.(removesFrozen, { actionIndex: 1, actions: [freezes, removesFrozen] })
                ).toBe(true);
            });
        });

        it('removes from a track whose freeze state matches', () => {
            mocks.getTrackStoreState.mockReturnValue(chainWith(false));
            mocks.prepareRemoveDevice.mockReturnValue('written');

            expect(handleRemoveDevice.execute(planned)).toEqual({ status: 'written' });
            expect(handleRemoveDevice.validate?.(planned, { actionIndex: 0, actions: [planned] })).toBe(true);
        });
    });
});
