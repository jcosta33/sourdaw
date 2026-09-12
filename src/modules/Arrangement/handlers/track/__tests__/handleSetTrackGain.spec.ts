import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackGain } from '../handleSetTrackGain';

const mocks = vi.hoisted(() => ({
    captureAutomationRecordingRollback: vi.fn<() => () => void>(() => vi.fn()),
    setTrackGain: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    captureAutomationRecordingRollback: mocks.captureAutomationRecordingRollback,
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackGain', () => ({
    setTrackGain: mocks.setTrackGain,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackGain', () => {
    it('validates the expected gain without writing runtime or project state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-1', gain: 0.5 }] });

        expect(
            handleSetTrackGain.validate?.(
                {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-1', gain: 0.8, expectedGain: 0.5 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(true);
        expect(
            handleSetTrackGain.validate?.(
                {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-1', gain: 0.8, expectedGain: 0.4 },
                },
                { actions: [], actionIndex: 0 }
            )
        ).toBe(false);
        expect(mocks.setTrackGain).not.toHaveBeenCalled();
    });

    it('validates a chained write against the prior planned gain', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-1', gain: 1 }] });
        const actions = [
            {
                type: 'setTrackGain' as const,
                payload: { trackId: 'track-1', gain: 0.8, expectedGain: 1 },
            },
            {
                type: 'setTrackGain' as const,
                payload: { trackId: 'track-1', gain: 0.6, expectedGain: 0.8 },
            },
        ];

        expect(handleSetTrackGain.validate?.(actions[1]!, { actions, actionIndex: 1 })).toBe(true);
        expect(mocks.setTrackGain).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('calls setTrackGain', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1 }] });
            void handleSetTrackGain.execute({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });
            expect(mocks.setTrackGain).toHaveBeenCalledWith('t1', 0.5, false, {
                automationRecordingPolicy: undefined,
            });
        });

        it('carries a suppressed recording policy into the write it delegates', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1 }] });

            void handleSetTrackGain.execute({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1, automationRecordingPolicy: 'suppressed' },
            });

            expect(mocks.setTrackGain).toHaveBeenCalledWith('t1', 0.5, false, {
                automationRecordingPolicy: 'suppressed',
            });
        });

        it('rejects a gain write when current project truth diverged', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 0.75 }] });

            const result = handleSetTrackGain.execute({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.setTrackGain).not.toHaveBeenCalled();
        });
    });

    describe('describe', () => {
        it('returns inverse action with previous gain', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1.0 }] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(desc.label).toBe('Set track gain');
            expect(desc.inverseAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 1.0, expectedGain: 0.5 },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1.0 },
            });
        });

        it('uses the app-owned expected gain when the track is created earlier in the batch', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(desc.inverseAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 1, expectedGain: 0.5 },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });
        });

        it('carries a suppressed recording policy into the inverse and redo it describes', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 1.0 }] });

            const desc = handleSetTrackGain.describe({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1, automationRecordingPolicy: 'suppressed' },
            });

            expect(desc.inverseAction).toEqual({
                type: 'setTrackGain',
                payload: {
                    trackId: 't1',
                    gain: 1.0,
                    expectedGain: 0.5,
                    automationRecordingPolicy: 'suppressed',
                },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackGain',
                payload: {
                    trackId: 't1',
                    gain: 0.5,
                    expectedGain: 1.0,
                    automationRecordingPolicy: 'suppressed',
                },
            });
        });
    });

    describe('prepareAbort', () => {
        it('snapshots the automation-recording state for an ordinary gain write', () => {
            handleSetTrackGain.prepareAbort?.({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1 },
            });

            expect(mocks.captureAutomationRecordingRollback).toHaveBeenCalledOnce();
        });

        it('leaves the automation-recording maps alone for a suppressed gain write', () => {
            const rollback = handleSetTrackGain.prepareAbort?.({
                type: 'setTrackGain',
                payload: { trackId: 't1', gain: 0.5, expectedGain: 1, automationRecordingPolicy: 'suppressed' },
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
                handleSetTrackGain.validateSessionEntry?.({
                    action: {
                        type: 'setTrackGain',
                        payload: { trackId: 't1', gain: 0.5, expectedGain: 1, automationRecordingPolicy: forward },
                    },
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 't1', gain: 1, expectedGain: 0.5, automationRecordingPolicy: replay },
                    },
                })
            ).toBe(false);
        });

        it.each([{ policy: 'suppressed' as const }, { policy: undefined }])(
            'accepts a persisted entry agreeing on $policy across forward, inverse and redo',
            ({ policy }) => {
                expect(
                    handleSetTrackGain.validateSessionEntry?.({
                        action: {
                            type: 'setTrackGain',
                            payload: { trackId: 't1', gain: 0.5, expectedGain: 1, automationRecordingPolicy: policy },
                        },
                        inverseAction: {
                            type: 'setTrackGain',
                            payload: { trackId: 't1', gain: 1, expectedGain: 0.5, automationRecordingPolicy: policy },
                        },
                        redoAction: {
                            type: 'setTrackGain',
                            payload: { trackId: 't1', gain: 0.5, expectedGain: 1, automationRecordingPolicy: policy },
                        },
                    })
                ).toBe(true);
            }
        );
    });

    // `docs/manual/02-concepts.md` lists track gain among the operations that
    // record from the assistant and the command list but not from the mixer
    // strip, which reaches `setTrackGain` directly. That contrast is only true
    // while this stays `true`.
    it('is undoable', () => {
        expect(handleSetTrackGain.undoable).toBe(true);
    });
});
