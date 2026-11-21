import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackHeight } from '../setTrackHeight';

const mocks = vi.hoisted(() => ({
    setTrackHeight: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; height: number; devices?: never[] }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight', () => ({
    setTrackHeight: mocks.setTrackHeight,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackHeight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setTrackHeight with the provided payload', () => {
        void handleSetTrackHeight.execute({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 150 },
        });

        expect(mocks.setTrackHeight).toHaveBeenCalledWith('t1', 150);
    });

    it('provides a description', () => {
        const desc = handleSetTrackHeight.describe({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 100 },
        });
        expect(desc.label).toBe('Set track height');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous height even when the forward height clamps', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 80 }] });

        const desc = handleSetTrackHeight.describe({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 999 },
        });

        // The forward setter clamps 999 to 300; the inverse restores the
        // captured height 80 and expects the 300 the writer stores.
        expect(desc.inverseAction).toEqual({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 80, expectedHeight: 300 },
        });
        expect(desc.redoAction).toEqual({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 300, expectedHeight: 80 },
        });
    });

    it('is undoable', () => {
        expect(handleSetTrackHeight.undoable).toBe(true);
    });

    describe('guarded replay', () => {
        const forward = (height: number, expectedHeight?: number) =>
            ({ type: 'setTrackHeight', payload: { trackId: 't1', height, expectedHeight } }) as const;
        const context = (action: ReturnType<typeof forward>) => ({ actions: [action], actionIndex: 0 });

        it('refuses a height outside the stored range rather than clamping it', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 80 }] });

            for (const height of [29, 301, Number.NaN]) {
                const action = forward(height);
                expect(handleSetTrackHeight.validate?.(action, context(action))).toBe(false);
                expect(handleSetTrackHeight.validationRefusalReason?.(action, context(action))).toContain(
                    'is outside 30 to 300'
                );
            }
            expect(handleSetTrackHeight.validate?.(forward(30), context(forward(30)))).toBe(true);
            expect(handleSetTrackHeight.validate?.(forward(300), context(forward(300)))).toBe(true);
        });

        it('refuses a track the project does not hold, naming it', () => {
            const action = forward(100);

            expect(handleSetTrackHeight.validate?.(action, context(action))).toBe(false);
            expect(handleSetTrackHeight.validationRefusalReason?.(action, context(action))).toBe(
                'Track "t1" does not exist'
            );
        });

        it('validates a restore only against the height it expects', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 120 }] });

            expect(handleSetTrackHeight.validate?.(forward(80, 120), context(forward(80, 120)))).toBe(true);
            expect(handleSetTrackHeight.validate?.(forward(80, 90), context(forward(80, 90)))).toBe(false);
        });

        it('conflicts without writing when the live height is not the one expected', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 120 }] });

            expect(handleSetTrackHeight.execute(forward(80, 90))).toEqual({ status: 'conflict' });
            expect(mocks.setTrackHeight).not.toHaveBeenCalled();
        });

        it('replays a stored guard-less inverse unguarded, as before guards existed', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 120 }] });
            const legacy = { type: 'setTrackHeight', payload: { trackId: 't1', height: 80 } } as const;

            expect(handleSetTrackHeight.validate?.(legacy, { actions: [legacy], actionIndex: 0 })).toBe(true);
            expect(handleSetTrackHeight.execute(legacy)).toEqual({ status: 'written' });
            expect(mocks.setTrackHeight).toHaveBeenCalledWith('t1', 80);
        });

        it('can be replayed after divergence only when it states what it expects', () => {
            expect(handleSetTrackHeight.canReapplyAfterDivergence?.(forward(80, 120))).toBe(true);
            expect(handleSetTrackHeight.canReapplyAfterDivergence?.(forward(80))).toBe(false);
        });

        it('is a no-op only when the stored height is already the requested and the expected one', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 120 }] });

            expect(handleSetTrackHeight.isNoop?.(forward(120))).toBe(true);
            expect(handleSetTrackHeight.isNoop?.(forward(120, 120))).toBe(true);
            expect(handleSetTrackHeight.isNoop?.(forward(120, 90))).toBe(false);
            expect(handleSetTrackHeight.isNoop?.(forward(500))).toBe(false);
        });
    });

    it('describes against the height an earlier action of its batch left', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 80, devices: [] }] });
        const first = { type: 'setTrackHeight', payload: { trackId: 't1', height: 120 } } as const;
        const second = { type: 'setTrackHeight', payload: { trackId: 't1', height: 200 } } as const;

        const description = handleSetTrackHeight.describe(second, { actions: [first, second], actionIndex: 1 });

        expect(description.inverseAction).toEqual({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 120, expectedHeight: 200 },
        });
        expect(description.redoAction).toEqual({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 200, expectedHeight: 120 },
        });
    });
});
