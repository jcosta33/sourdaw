import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreTrackHeights } from '../restoreTrackHeights';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/setTrackStoreState', () => ({ setTrackStoreState: mocks.setTrackStoreState }));

function withTracks(heights: (number | undefined)[]) {
    mocks.getTrackStoreState.mockReturnValue({
        tracks: heights.map((height, index) => ({ id: `t${index + 1}`, name: `Track ${index + 1}`, height })),
        selectedTrackId: null,
    });
}

const restore = (expected: { trackId: string; height: number }[], replacement: { trackId: string; height: number }[]) =>
    handleRestoreTrackHeights.execute({ type: 'restoreTrackHeights', payload: { expected, replacement } });

describe('handleRestoreTrackHeights', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        withTracks([74, 110]);
    });

    it('writes the replacement heights when every expected height still holds', () => {
        const result = restore(
            [
                { trackId: 't1', height: 74 },
                { trackId: 't2', height: 110 },
            ],
            [
                { trackId: 't1', height: 64 },
                { trackId: 't2', height: 100 },
            ]
        );

        expect(result).toEqual({ status: 'written' });
        expect(mocks.setTrackStoreState).toHaveBeenCalledTimes(1);
        expect(mocks.setTrackStoreState.mock.calls[0]?.[0]?.tracks).toEqual([
            { id: 't1', name: 'Track 1', height: 64 },
            { id: 't2', name: 'Track 2', height: 100 },
        ]);
    });

    it('leaves a track the payload does not name untouched', async () => {
        withTracks([74, 110, 200]);

        await restore([{ trackId: 't1', height: 74 }], [{ trackId: 't1', height: 64 }]);

        expect(mocks.setTrackStoreState.mock.calls[0]?.[0]?.tracks[2]).toEqual({
            id: 't3',
            name: 'Track 3',
            height: 200,
        });
    });

    it('conflicts and writes nothing when one height changed since capture', () => {
        // Stands in for a collaborator resizing t2 between the zoom and the undo:
        // replaying the captured heights would silently discard that resize.
        withTracks([74, 250]);

        const result = restore(
            [
                { trackId: 't1', height: 74 },
                { trackId: 't2', height: 110 },
            ],
            [
                { trackId: 't1', height: 64 },
                { trackId: 't2', height: 100 },
            ]
        );

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('conflicts when an expected track is gone', () => {
        withTracks([74]);

        expect(
            restore(
                [
                    { trackId: 't1', height: 74 },
                    { trackId: 't2', height: 110 },
                ],
                [
                    { trackId: 't1', height: 64 },
                    { trackId: 't2', height: 100 },
                ]
            )
        ).toEqual({ status: 'conflict' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('conflicts when the track store is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        expect(restore([{ trackId: 't1', height: 74 }], [{ trackId: 't1', height: 64 }])).toEqual({
            status: 'conflict',
        });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('compares a missing height against the default rather than failing the guard', () => {
        withTracks([undefined]);

        expect(restore([{ trackId: 't1', height: 64 }], [{ trackId: 't1', height: 90 }])).toEqual({
            status: 'written',
        });
    });

    it('reports a no-op when the replacement heights are already live', () => {
        expect(
            handleRestoreTrackHeights.isNoop?.({
                type: 'restoreTrackHeights',
                payload: {
                    expected: [{ trackId: 't1', height: 64 }],
                    replacement: [
                        { trackId: 't1', height: 74 },
                        { trackId: 't2', height: 110 },
                    ],
                },
            })
        ).toBe(true);
    });

    it('is not undoable', () => {
        // An inverse that records its own undo entry stops undo from converging.
        expect(handleRestoreTrackHeights.undoable).toBe(false);
    });

    describe('batch validation', () => {
        const moved = { type: 'setTrackHeight', payload: { trackId: 't1', height: 90 } } as const;
        const restoreAction = (height: number) =>
            ({
                type: 'restoreTrackHeights',
                payload: { expected: [{ trackId: 't1', height }], replacement: [{ trackId: 't1', height: 74 }] },
            }) as const;

        beforeEach(() => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', name: 'Track 1', height: 74, devices: [] }],
                selectedTrackId: null,
            });
        });

        it('admits a restore whose expected heights the planned batch state matches', () => {
            const action = restoreAction(90);
            const context = { actions: [moved, action], actionIndex: 1 };

            expect(handleRestoreTrackHeights.validate?.(action, context)).toBe(true);
            expect(handleRestoreTrackHeights.validationRefusalReason?.(action, context)).toBeNull();
        });

        it('refuses a restore whose expected heights the planned batch state contradicts, with its reason', () => {
            const action = restoreAction(74);
            const context = { actions: [moved, action], actionIndex: 1 };

            expect(handleRestoreTrackHeights.validate?.(action, context)).toBe(false);
            expect(handleRestoreTrackHeights.validationRefusalReason?.(action, context)).toBe(
                'Track heights changed after the zoom or resize this restores'
            );
        });

        it('refuses a restore naming a track the batch state does not hold', () => {
            const action = {
                type: 'restoreTrackHeights',
                payload: {
                    expected: [{ trackId: 'ghost', height: 74 }],
                    replacement: [{ trackId: 'ghost', height: 64 }],
                },
            } as const;

            expect(handleRestoreTrackHeights.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
        });

        it('may always be replayed after divergence, since every restore names the heights it expects', () => {
            expect(handleRestoreTrackHeights.canReapplyAfterDivergence?.(restoreAction(74), undefined)).toBe(true);
        });
    });
});
