import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackPan } from '../handleSetTrackPan';

const mocks = vi.hoisted(() => ({
    captureAutomationRecordingRollback: vi.fn<() => () => void>(() => vi.fn()),
    setTrackPan: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    captureAutomationRecordingRollback: mocks.captureAutomationRecordingRollback,
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackPan', () => ({
    setTrackPan: mocks.setTrackPan,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackPan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('validates the expected pan without writing runtime or project state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0 }] });

        expect(
            handleSetTrackPan.validate?.(
                {
                    type: 'setTrackPan',
                    payload: { trackId: 't1', pan: -20, expectedPan: 0 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(true);
        expect(
            handleSetTrackPan.validate?.(
                {
                    type: 'setTrackPan',
                    payload: { trackId: 't1', pan: -20, expectedPan: 12 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(false);
        expect(mocks.setTrackPan).not.toHaveBeenCalled();
    });

    describe('execute', () => {
        it('calls setTrackPan', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0 }] });
            void handleSetTrackPan.execute({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0 },
            });
            expect(mocks.setTrackPan).toHaveBeenCalledWith('t1', -0.5, false, {
                automationRecordingPolicy: undefined,
            });
        });

        it('carries a suppressed recording policy into the write it delegates', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0 }] });

            void handleSetTrackPan.execute({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0, automationRecordingPolicy: 'suppressed' },
            });

            expect(mocks.setTrackPan).toHaveBeenCalledWith('t1', -0.5, false, {
                automationRecordingPolicy: 'suppressed',
            });
        });

        it('rejects a pan write when current project truth diverged', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 12 }] });

            const result = handleSetTrackPan.execute({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -20, expectedPan: 0 },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.setTrackPan).not.toHaveBeenCalled();
        });
    });

    describe('describe', () => {
        it('returns inverse action with previous pan', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0.5 }] });

            const desc = handleSetTrackPan.describe({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0.5 },
            });

            expect(desc.label).toBe('Set track pan');
            expect(desc.inverseAction).toEqual({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: 0.5, expectedPan: -0.5 },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0.5 },
            });
        });

        it('returns null inverse action if track not found', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleSetTrackPan.describe({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0 },
            });

            expect(desc.inverseAction).toBeNull();
        });

        it('carries a suppressed recording policy into the inverse and redo it describes', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', pan: 0.5 }] });

            const desc = handleSetTrackPan.describe({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0.5, automationRecordingPolicy: 'suppressed' },
            });

            expect(desc.inverseAction).toEqual({
                type: 'setTrackPan',
                payload: {
                    trackId: 't1',
                    pan: 0.5,
                    expectedPan: -0.5,
                    automationRecordingPolicy: 'suppressed',
                },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackPan',
                payload: {
                    trackId: 't1',
                    pan: -0.5,
                    expectedPan: 0.5,
                    automationRecordingPolicy: 'suppressed',
                },
            });
        });
    });

    describe('prepareAbort', () => {
        it('snapshots the automation-recording state for an ordinary pan write', () => {
            handleSetTrackPan.prepareAbort?.({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0 },
            });

            expect(mocks.captureAutomationRecordingRollback).toHaveBeenCalledOnce();
        });

        it('leaves the automation-recording maps alone for a suppressed pan write', () => {
            const rollback = handleSetTrackPan.prepareAbort?.({
                type: 'setTrackPan',
                payload: { trackId: 't1', pan: -0.5, expectedPan: 0, automationRecordingPolicy: 'suppressed' },
            });

            expect(rollback).toBeTypeOf('function');
            expect(rollback?.()).toBeUndefined();
            expect(mocks.captureAutomationRecordingRollback).not.toHaveBeenCalled();
        });
    });

    describe('validateSessionEntry', () => {
        it.each([
            { forward: 'suppressed' as const, name: 'suppressed forward, unsuppressed inverse', replay: undefined },
            { forward: undefined, name: 'unsuppressed forward, suppressed inverse', replay: 'suppressed' as const },
        ])('refuses a persisted $name pair', ({ forward, replay }) => {
            expect(
                handleSetTrackPan.validateSessionEntry?.({
                    action: {
                        type: 'setTrackPan',
                        payload: { trackId: 't1', pan: -0.5, expectedPan: 0, automationRecordingPolicy: forward },
                    },
                    inverseAction: {
                        type: 'setTrackPan',
                        payload: { trackId: 't1', pan: 0, expectedPan: -0.5, automationRecordingPolicy: replay },
                    },
                })
            ).toBe(false);
        });

        it.each([{ policy: 'suppressed' as const }, { policy: undefined }])(
            'accepts a persisted entry agreeing on $policy across forward, inverse and redo',
            ({ policy }) => {
                expect(
                    handleSetTrackPan.validateSessionEntry?.({
                        action: {
                            type: 'setTrackPan',
                            payload: { trackId: 't1', pan: -0.5, expectedPan: 0, automationRecordingPolicy: policy },
                        },
                        inverseAction: {
                            type: 'setTrackPan',
                            payload: { trackId: 't1', pan: 0, expectedPan: -0.5, automationRecordingPolicy: policy },
                        },
                        redoAction: {
                            type: 'setTrackPan',
                            payload: { trackId: 't1', pan: -0.5, expectedPan: 0, automationRecordingPolicy: policy },
                        },
                    })
                ).toBe(true);
            }
        );

        it('accepts an entry whose inverse is absent because the track was not found', () => {
            expect(
                handleSetTrackPan.validateSessionEntry?.({
                    action: {
                        type: 'setTrackPan',
                        payload: {
                            trackId: 't1',
                            pan: -0.5,
                            expectedPan: 0,
                            automationRecordingPolicy: 'suppressed',
                        },
                    },
                    inverseAction: null,
                })
            ).toBe(true);
        });
    });

    it('is undoable', () => {
        expect(handleSetTrackPan.undoable).toBe(true);
    });
});
