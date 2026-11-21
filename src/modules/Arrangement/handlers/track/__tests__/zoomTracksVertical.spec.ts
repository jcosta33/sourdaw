import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '../../../models/Track';
import { captureTrackRemovalSnapshot } from '../../../useCases/captureTrackRemovalSnapshot';
import { handleZoomTracksVertical } from '../zoomTracksVertical';

const mocks = vi.hoisted(() => ({
    zoomTracksVertical: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

// Only the writer is stubbed. `clampTrackHeight` lives in its own module and is
// deliberately left real: it is the arithmetic the inverse is guarded on, so a stubbed
// clamp would let the handler and the use case disagree without any test noticing.
vi.mock('../../../useCases/trackZoom', () => ({ zoomTracksVertical: mocks.zoomTracksVertical }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));

function withTracks(heights: (number | undefined)[]) {
    mocks.getTrackStoreState.mockReturnValue({
        tracks: heights.map((height, index) => ({ id: `t${index + 1}`, height })),
    });
}

describe('handleZoomTracksVertical', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        withTracks([64, 100]);
    });

    it('executes zoomTracksVertical with the provided payload', () => {
        void handleZoomTracksVertical.execute({ type: 'zoomTracksVertical', payload: { delta: 1 } });

        expect(mocks.zoomTracksVertical).toHaveBeenCalledWith(1);
    });

    it('provides a description reflecting the zoom direction', () => {
        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: 1 } }).label).toBe(
            'Zoom tracks vertical in'
        );
        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: -1 } }).label).toBe(
            'Zoom tracks vertical out'
        );
    });

    it('describes a height restore carrying the prior heights, not an opposite zoom', () => {
        const description = handleZoomTracksVertical.describe({
            type: 'zoomTracksVertical',
            payload: { delta: 10 },
        });

        expect(description.inverseAction).toEqual({
            type: 'restoreTrackHeights',
            payload: {
                expected: [
                    { trackId: 't1', height: 74 },
                    { trackId: 't2', height: 110 },
                ],
                replacement: [
                    { trackId: 't1', height: 64 },
                    { trackId: 't2', height: 100 },
                ],
            },
        });
        expect(description.redoAction).toEqual({
            type: 'restoreTrackHeights',
            payload: {
                expected: [
                    { trackId: 't1', height: 64 },
                    { trackId: 't2', height: 100 },
                ],
                replacement: [
                    { trackId: 't1', height: 74 },
                    { trackId: 't2', height: 110 },
                ],
            },
        });
    });

    it('carries the height a clamped track keeps, which an opposite delta would not return it to', () => {
        // t1 is pinned at the 300 ceiling: zooming in leaves it there, so undoing with
        // delta -50 would drop it to 250 — a height it never had.
        withTracks([300, 100]);

        const description = handleZoomTracksVertical.describe({
            type: 'zoomTracksVertical',
            payload: { delta: 50 },
        });

        expect(description.inverseAction).toMatchObject({
            payload: {
                expected: [
                    { trackId: 't1', height: 300 },
                    { trackId: 't2', height: 150 },
                ],
                replacement: [
                    { trackId: 't1', height: 300 },
                    { trackId: 't2', height: 100 },
                ],
            },
        });
    });

    it('treats a missing height as the default rather than dropping the track', () => {
        withTracks([undefined]);

        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: 6 } })).toMatchObject({
            inverseAction: {
                payload: { expected: [{ trackId: 't1', height: 70 }], replacement: [{ trackId: 't1', height: 64 }] },
            },
        });
    });

    it('emits no inverse when there are no tracks', () => {
        withTracks([]);

        expect(handleZoomTracksVertical.describe({ type: 'zoomTracksVertical', payload: { delta: 1 } })).toEqual({
            label: 'Zoom tracks vertical',
            inverseAction: null,
        });
    });

    it('reports a no-op when every track is already pinned at the bound', () => {
        withTracks([300, 300]);

        expect(handleZoomTracksVertical.isNoop?.({ type: 'zoomTracksVertical', payload: { delta: 10 } })).toBe(true);
    });

    it('is not a no-op while any track can still move', () => {
        withTracks([300, 100]);

        expect(handleZoomTracksVertical.isNoop?.({ type: 'zoomTracksVertical', payload: { delta: 10 } })).toBe(false);
    });

    it('is undoable', () => {
        expect(handleZoomTracksVertical.undoable).toBe(true);
    });

    it('describes against the heights the earlier actions of its batch leave', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't1', height: 64, devices: [] },
                { id: 't2', height: 100, devices: [] },
            ],
        });
        const zoom = { type: 'zoomTracksVertical', payload: { delta: 10 } } as const;

        const description = handleZoomTracksVertical.describe(zoom, {
            actions: [{ type: 'setTrackHeight', payload: { trackId: 't1', height: 150 } }, zoom],
            actionIndex: 1,
        });

        expect(description.inverseAction).toEqual({
            type: 'restoreTrackHeights',
            payload: {
                expected: [
                    { trackId: 't1', height: 160 },
                    { trackId: 't2', height: 110 },
                ],
                replacement: [
                    { trackId: 't1', height: 150 },
                    { trackId: 't2', height: 100 },
                ],
            },
        });
    });

    it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 271, -271])('refuses a delta of %s', (delta) => {
        const action = { type: 'zoomTracksVertical', payload: { delta } } as const;

        expect(handleZoomTracksVertical.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
        expect(
            handleZoomTracksVertical.validationRefusalReason?.(action, { actions: [action], actionIndex: 0 })
        ).toContain(`A vertical zoom of ${delta} pixels moves no track`);
    });

    it('accepts a nonzero delta up to the height range either way', () => {
        for (const delta of [1, -1, 270, -270]) {
            const action = { type: 'zoomTracksVertical', payload: { delta } } as const;
            expect(handleZoomTracksVertical.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
        }
    });

    describe('saved entry validation', () => {
        const zoom = { type: 'zoomTracksVertical', payload: { delta: 10 } } as const;

        function describedEntry() {
            const description = handleZoomTracksVertical.describe(zoom);
            if (!description.inverseAction || !description.redoAction) {
                throw new Error('Expected a described zoom');
            }
            return { action: zoom, inverseAction: description.inverseAction, redoAction: description.redoAction };
        }

        it('accepts the entry the zoom itself describes', () => {
            expect(handleZoomTracksVertical.validateSessionEntry?.(describedEntry())).toBe(true);
        });

        it('refuses a restore whose settled heights are not what the zoom leaves', () => {
            const entry = describedEntry();
            if (entry.inverseAction.type !== 'restoreTrackHeights') {
                throw new Error('Expected a height restore');
            }
            const tampered = {
                ...entry,
                inverseAction: {
                    ...entry.inverseAction,
                    payload: {
                        ...entry.inverseAction.payload,
                        expected: entry.inverseAction.payload.expected.map((height) => ({
                            ...height,
                            height: height.height + 1,
                        })),
                    },
                },
            };

            expect(handleZoomTracksVertical.validateSessionEntry?.(tampered)).toBe(false);
        });

        /** The described zoom entry with its undo and redo height lists replaced, each check isolated. */
        function entryWithHeights(heights: {
            settled?: { trackId: string; height: number }[];
            previous?: { trackId: string; height: number }[];
            redoExpected?: { trackId: string; height: number }[];
            redoReplacement?: { trackId: string; height: number }[];
        }) {
            const settled = heights.settled ?? [
                { trackId: 't1', height: 74 },
                { trackId: 't2', height: 110 },
            ];
            const previous = heights.previous ?? [
                { trackId: 't1', height: 64 },
                { trackId: 't2', height: 100 },
            ];
            return {
                action: zoom,
                inverseAction: {
                    type: 'restoreTrackHeights',
                    payload: { expected: settled, replacement: previous },
                },
                redoAction: {
                    type: 'restoreTrackHeights',
                    payload: {
                        expected: heights.redoExpected ?? previous,
                        replacement: heights.redoReplacement ?? settled,
                    },
                },
            } as const;
        }

        it('accepts the isolated entry builder with every list right', () => {
            expect(handleZoomTracksVertical.validateSessionEntry?.(entryWithHeights({}))).toBe(true);
        });

        it.each([
            [
                'only the redo expectation is wrong',
                {
                    redoExpected: [
                        { trackId: 't1', height: 65 },
                        { trackId: 't2', height: 100 },
                    ],
                },
            ],
            [
                'only the redo replacement is wrong',
                {
                    redoReplacement: [
                        { trackId: 't1', height: 75 },
                        { trackId: 't2', height: 110 },
                    ],
                },
            ],
            [
                'the settled list is shorter than the previous list',
                {
                    settled: [{ trackId: 't1', height: 74 }],
                    redoReplacement: [{ trackId: 't1', height: 74 }],
                },
            ],
            ['the settled list is empty', { settled: [], redoReplacement: [] }],
            [
                'a settled track id is renamed',
                {
                    settled: [
                        { trackId: 't1', height: 74 },
                        { trackId: 'other', height: 110 },
                    ],
                    redoReplacement: [
                        { trackId: 't1', height: 74 },
                        { trackId: 'other', height: 110 },
                    ],
                },
            ],
            [
                'the settled tracks are reordered',
                {
                    settled: [
                        { trackId: 't2', height: 74 },
                        { trackId: 't1', height: 110 },
                    ],
                    redoReplacement: [
                        { trackId: 't2', height: 74 },
                        { trackId: 't1', height: 110 },
                    ],
                },
            ],
        ])('refuses a saved zoom when %s', (_name, heights) => {
            expect(handleZoomTracksVertical.validateSessionEntry?.(entryWithHeights(heights))).toBe(false);
        });

        it('refuses an entry whose redo is not its undo reversed, or that has none', () => {
            const entry = describedEntry();

            expect(handleZoomTracksVertical.validateSessionEntry?.({ ...entry, redoAction: entry.inverseAction })).toBe(
                false
            );
            expect(handleZoomTracksVertical.validateSessionEntry?.({ ...entry, redoAction: undefined })).toBe(false);
        });
    });

    describe('batch track list', () => {
        const zoom = { type: 'zoomTracksVertical', payload: { delta: 10 } } as const;
        const heightsOf = (description: ReturnType<typeof handleZoomTracksVertical.describe>) => {
            const inverse = description.inverseAction;
            if (inverse?.type !== 'restoreTrackHeights') {
                return [];
            }
            return inverse.payload.replacement.map((entry) => `${entry.trackId}:${entry.height}`);
        };

        it('names a folder an earlier createFolder creates, and a copy an earlier duplicateTrack creates', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 64, devices: [] }] });
            const create = { type: 'createFolder', payload: { name: 'F', folderTrackId: 'folder' } } as const;
            const duplicate = { type: 'duplicateTrack', payload: { trackId: 't1', targetTrackId: 'copy' } } as const;

            const description = handleZoomTracksVertical.describe(zoom, {
                actions: [create, duplicate, zoom],
                actionIndex: 2,
            });

            expect(heightsOf(description)).toEqual(['t1:64', 'folder:80', 'copy:64']);
        });

        it('names a track an earlier restoreTrack restores, at the height its snapshot holds', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ ...createTrack({ id: 'gone', name: 'Gone', kind: 'audio' }), height: 120 }],
            });
            const snapshot = captureTrackRemovalSnapshot('gone');
            if (!snapshot) {
                throw new Error('Expected a removal snapshot');
            }
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 64, devices: [] }] });
            const restore = { type: 'restoreTrack', payload: snapshot } as const;

            const description = handleZoomTracksVertical.describe(zoom, { actions: [restore, zoom], actionIndex: 1 });

            expect(heightsOf(description)).toEqual(['t1:64', 'gone:120']);
        });

        it('refuses a batch whose restored track cannot be planned from its snapshot', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [createTrack({ id: 'gone', name: 'Gone', kind: 'audio' })],
            });
            const snapshot = captureTrackRemovalSnapshot('gone');
            if (!snapshot) {
                throw new Error('Expected a removal snapshot');
            }
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 64, devices: [] }] });
            const restore = { type: 'restoreTrack', payload: { ...snapshot, trackSnapshot: { id: 'gone' } } } as const;

            expect(() => handleZoomTracksVertical.describe(zoom, { actions: [restore, zoom], actionIndex: 1 })).toThrow(
                'Track "gone" an earlier action creates cannot be planned'
            );
        });

        it('leaves out a track an earlier removeTrack removes', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    { id: 't1', height: 64, devices: [] },
                    { id: 't2', height: 80, devices: [] },
                ],
            });
            const remove = { type: 'removeTrack', payload: { trackId: 't2' } } as const;

            const description = handleZoomTracksVertical.describe(zoom, { actions: [remove, zoom], actionIndex: 1 });

            expect(heightsOf(description)).toEqual(['t1:64']);
        });

        it.each([
            [
                'an action whose track id is minted when it runs',
                { type: 'loadTrackTemplate', payload: { templateId: 'x' } },
            ],
            ['an addTrack that names no id', { type: 'addTrack', payload: { kind: 'audio' } }],
            ['a duplicateTrack that names no target', { type: 'duplicateTrack', payload: { trackId: 't1' } }],
        ] as const)('refuses a batch holding %s, naming its type', (_name, creator) => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 64, devices: [] }] });

            expect(() => handleZoomTracksVertical.describe(zoom, { actions: [creator, zoom], actionIndex: 1 })).toThrow(
                `${creator.type} creates a track whose id is not known`
            );
        });
    });
});
