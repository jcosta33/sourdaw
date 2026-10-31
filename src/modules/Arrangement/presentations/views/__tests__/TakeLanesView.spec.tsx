import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { normalizeTrack } from '../../../models/Track';
import { TakeLanePanel, TakeLanesView } from '../TakeLanesView';

import type { Take, TakeLane } from '../../../models/TakeLane';
import type { Clip, Track } from '../../../models/Track';

type GetTakeLaneForTrackMock = (trackId: string) => TakeLane | null;
type LaneState = { lanes: TakeLane[] };
type TrackState = { tracks: Track[]; selectedTrackId: string | null };

const mocks = vi.hoisted(() => ({
    addTake: vi.fn(),
    addTakeLane: vi.fn(),
    flattenComp: vi.fn(),
    getTakeLaneForTrack: vi.fn<GetTakeLaneForTrackMock>(),
    removeCompRegion: vi.fn(),
    selectTake: vi.fn(),
    setCompRegion: vi.fn(),
}));

// Explicit return type (not `as`) so the empty arrays widen for later test reassignments.
const state = vi.hoisted((): { laneState: LaneState; trackState: TrackState } => ({
    laneState: { lanes: [] },
    trackState: { tracks: [], selectedTrackId: null },
}));

vi.mock('../../../stores/takeLaneStore', () => ({ takeLaneStore: 'take-lane-store' }));
vi.mock('../../../stores/trackStore', () => ({ trackStore: 'track-store' }));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: unknown, defaultValue: unknown) => {
        if (store === 'take-lane-store') {
            return state.laneState;
        }
        if (store === 'track-store') {
            return state.trackState;
        }
        return defaultValue;
    }),
}));

vi.mock('../../../useCases/comping/addTake', () => ({ addTake: mocks.addTake }));
vi.mock('../../../useCases/comping/addTakeLane', () => ({ addTakeLane: mocks.addTakeLane }));
vi.mock('../../../useCases/comping/flattenComp', () => ({ flattenComp: mocks.flattenComp }));
vi.mock('../../../useCases/comping/getTakeLaneForTrack', () => ({ getTakeLaneForTrack: mocks.getTakeLaneForTrack }));
vi.mock('../../../useCases/comping/removeCompRegion', () => ({ removeCompRegion: mocks.removeCompRegion }));
vi.mock('../../../useCases/comping/selectTake', () => ({ selectTake: mocks.selectTake }));
vi.mock('../../../useCases/comping/setCompRegion', () => ({ setCompRegion: mocks.setCompRegion }));

function makeClip(overrides: Partial<Clip> & Pick<Clip, 'id'>): Clip {
    return {
        trackId: 't1',
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function makeTake(overrides: Partial<Take> & Pick<Take, 'id'>): Take {
    return {
        clipId: 'c1',
        name: 'Take',
        startBeat: 0,
        endBeat: 4,
        selected: false,
        ...overrides,
    };
}

function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'name' | 'kind'>): Track {
    return normalizeTrack(overrides);
}

const PRIMARY_POINTER = { pointerId: 1, isPrimary: true, button: 0 };

const stripRect = { width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0, toJSON: () => {} };

function resetMocks(): void {
    vi.clearAllMocks();
    state.laneState = { lanes: [] };
    state.trackState = { tracks: [], selectedTrackId: null };
    mocks.getTakeLaneForTrack.mockReturnValue(null);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(stripRect);
}

describe('TakeLanesView', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.restoreAllMocks());

    it('shows the enablement hint when no track has variation lanes toggled on', () => {
        state.trackState = {
            tracks: [makeTrack({ id: 't1', name: 'Drums', kind: 'audio', showVariationLanes: false })],
            selectedTrackId: null,
        };
        render(<TakeLanesView />);
        expect(screen.getByText(/toggle "variation lanes"/i)).toBeInTheDocument();
    });

    it('opens the panel for a track whose toggle is on but that has no alternatives yet, so a first take can be added', () => {
        state.trackState = {
            tracks: [makeTrack({ id: 't1', name: 'Bass', kind: 'midi', showVariationLanes: true, alternatives: [] })],
            selectedTrackId: null,
        };
        render(<TakeLanesView />);
        expect(screen.getByText('Takes · Bass')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add take' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Initialize take lane' })).toBeInTheDocument();
    });

    it('renders one panel per eligible track and excludes master/folder tracks even when toggled on', () => {
        state.trackState = {
            tracks: [
                makeTrack({ id: 't1', name: 'Vox', kind: 'audio', showVariationLanes: true }),
                makeTrack({ id: 't2', name: 'Hidden', kind: 'audio', showVariationLanes: false }),
                makeTrack({ id: 't3', name: 'Master', kind: 'master', showVariationLanes: true }),
                makeTrack({ id: 't4', name: 'Group', kind: 'folder', showVariationLanes: true }),
            ],
            selectedTrackId: null,
        };
        render(<TakeLanesView />);
        expect(screen.getByText('Takes · Vox')).toBeInTheDocument();
        expect(screen.queryByText(/Takes · Hidden/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Takes · Master/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Takes · Group/)).not.toBeInTheDocument();
    });
});

describe('TakeLanePanel', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.restoreAllMocks());

    const renderPanel = (trackId = 't1') =>
        render(<TakeLanePanel trackId={trackId} trackName="Vox" trackColor="#4de" />);

    it('reports the track as missing when it is absent from the track store', () => {
        renderPanel('missing');
        expect(screen.getByText('Track not found.')).toBeInTheDocument();
    });

    it('shows pluralized take and comp region counts from the lane state', () => {
        state.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        state.laneState = {
            lanes: [
                {
                    id: 'lane1',
                    trackId: 't1',
                    takes: [makeTake({ id: 'take1' }), makeTake({ id: 'take2' })],
                    activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take1' }],
                },
            ],
        };
        const { container } = renderPanel();
        expect(container.textContent).toContain('2 takes · 1 comp region');
    });

    it('handles "Add take": initializes a lane from the first clip, or falls back to a synthetic take with no clips', () => {
        state.trackState = {
            tracks: [
                makeTrack({
                    id: 't1',
                    name: 'Vox',
                    kind: 'audio',
                    clips: [makeClip({ id: 'c1', startBeat: 2, endBeat: 9 })],
                }),
            ],
            selectedTrackId: null,
        };
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Add take' }));
        expect(mocks.addTakeLane).toHaveBeenCalledWith('t1');
        expect(mocks.addTake).toHaveBeenCalledWith('t1', 'c1', 'Take 1', 2, 9);
        cleanup();

        vi.clearAllMocks();
        state.trackState = {
            tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio', clips: [] })],
            selectedTrackId: null,
        };
        mocks.getTakeLaneForTrack.mockReturnValue({ id: 'lane1', trackId: 't1', takes: [], activeCompRegions: [] });
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Add take' }));
        expect(mocks.addTakeLane).not.toHaveBeenCalled();
        expect(mocks.addTake).toHaveBeenCalledWith('t1', 't1-synthetic', 'Take 1', 0, 16);
    });

    it('initializes a lane from the "Lane" button while none exists, then hides it and enables Flatten once one does', () => {
        state.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        const { rerender } = renderPanel();
        expect(screen.getByRole('button', { name: 'Flatten comp' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Initialize take lane' }));
        expect(mocks.addTakeLane).toHaveBeenCalledWith('t1');

        state.laneState = { lanes: [{ id: 'lane1', trackId: 't1', takes: [], activeCompRegions: [] }] };
        rerender(<TakeLanePanel trackId="t1" trackName="Vox" trackColor="#4de" />);
        expect(screen.queryByRole('button', { name: 'Initialize take lane' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Flatten comp' }));
        expect(mocks.flattenComp).toHaveBeenCalledWith('t1');
    });

    it('promotes a take to the active take when its row toggle is clicked', () => {
        state.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        state.laneState = {
            lanes: [
                {
                    id: 'lane1',
                    trackId: 't1',
                    takes: [makeTake({ id: 'take1', name: 'Take A' })],
                    activeCompRegions: [],
                },
            ],
        };
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Promote Take A to main take' }));
        expect(mocks.selectTake).toHaveBeenCalledWith('t1', 'take1');
    });

    it('creates a comp region by dragging across the take row, then removes it via the overlay trash button', () => {
        state.trackState = {
            tracks: [
                makeTrack({
                    id: 't1',
                    name: 'Vox',
                    kind: 'audio',
                    clips: [makeClip({ id: 'c1', startBeat: 0, endBeat: 8 })],
                }),
            ],
            selectedTrackId: null,
        };
        state.laneState = {
            lanes: [
                {
                    id: 'lane1',
                    trackId: 't1',
                    takes: [makeTake({ id: 'take1', name: 'Take A', endBeat: 8 })],
                    activeCompRegions: [],
                },
            ],
        };
        const { container, rerender } = renderPanel();
        const row = container.querySelector('[role="presentation"]')!;
        fireEvent.pointerDown(row, { ...PRIMARY_POINTER, clientX: 50 });
        fireEvent.pointerMove(row, { pointerId: 1, buttons: 1, clientX: 150 });
        fireEvent.pointerUp(row, { pointerId: 1, button: 0, clientX: 150 });
        expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 2, endBeat: 6, takeId: 'take1' });

        state.laneState = {
            lanes: [
                {
                    id: 'lane1',
                    trackId: 't1',
                    takes: [makeTake({ id: 'take1', name: 'Take A' })],
                    activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: 'take1' }],
                },
            ],
        };
        rerender(<TakeLanePanel trackId="t1" trackName="Vox" trackColor="#4de" />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove comp region Take A' }));
        expect(mocks.removeCompRegion).toHaveBeenCalledWith('t1', 2);
    });

    it('keeps the drag preview and take extent pointer-transparent so a release always targets the strip', () => {
        state.trackState = {
            tracks: [
                makeTrack({
                    id: 't1',
                    name: 'Vox',
                    kind: 'audio',
                    clips: [makeClip({ id: 'c1', startBeat: 0, endBeat: 8 })],
                }),
            ],
            selectedTrackId: null,
        };
        state.laneState = {
            lanes: [
                {
                    id: 'lane1',
                    trackId: 't1',
                    takes: [makeTake({ id: 'take1', name: 'Take A' })],
                    activeCompRegions: [],
                },
            ],
        };
        const { container } = renderPanel();
        const strip = container.querySelector('[role="presentation"]')!;
        fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
        fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });

        const decorations = Array.from(strip.children);
        expect(decorations.length).toBeGreaterThanOrEqual(2);
        for (const decoration of decorations) {
            expect(decoration.classList.contains('pointer-events-none')).toBe(true);
        }
    });

    describe('comp swipe gesture', () => {
        const renderSwipePanel = (take: Take, clips: Clip[]) => {
            state.trackState = {
                tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio', clips })],
                selectedTrackId: null,
            };
            state.laneState = {
                lanes: [{ id: 'lane1', trackId: 't1', takes: [take], activeCompRegions: [] }],
            };
            const { container } = renderPanel();
            return container.querySelector<HTMLElement>('[role="presentation"]')!;
        };
        const clip0to8 = [makeClip({ id: 'c1', startBeat: 0, endBeat: 8 })];
        const takeA0to8 = makeTake({ id: 'take1', name: 'Take A', endBeat: 8 });

        it('keeps swiping after the pointer leaves the row and commits the region clamped to the row edge', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            const setPointerCapture = vi.spyOn(strip, 'setPointerCapture');
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            expect(setPointerCapture).toHaveBeenCalledWith(PRIMARY_POINTER.pointerId);
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            fireEvent.mouseLeave(strip);
            fireEvent.pointerLeave(strip);
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 400 });
            expect(strip.children).toHaveLength(2);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 400 });
            expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 2, endBeat: 8, takeId: 'take1' });
        });

        it('does not commit when a non-primary button is released, and drops the preview', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            fireEvent.pointerUp(strip, { pointerId: 1, button: 2, clientX: 150 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
            expect(strip.children).toHaveLength(1);
        });

        it('does not start a swipe from a non-primary button or a non-primary pointer', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { pointerId: 1, isPrimary: true, button: 2, clientX: 50 });
            fireEvent.pointerDown(strip, { pointerId: 2, isPrimary: false, button: 0, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 2, clientX: 150 });
            fireEvent.pointerUp(strip, { pointerId: 2, button: 0, clientX: 150 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
            expect(strip.children).toHaveLength(1);
        });

        it('commits the release position when the move and release land before React re-renders', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            act(() => {
                fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 100 });
                fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
                fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 175 });
            });
            expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 2, endBeat: 7, takeId: 'take1' });
        });

        it('commits a swipe released with no prior move from the release position alone', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 100 });
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 20 });
            expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 0.8, endBeat: 4, takeId: 'take1' });
        });

        it('draws an overhanging take inside the strip but previews and commits only the part inside its clip', () => {
            const strip = renderSwipePanel(makeTake({ id: 'take1', name: 'Take A', startBeat: 2, endBeat: 12 }), [
                makeClip({ id: 'c1', startBeat: 4, endBeat: 8 }),
            ]);
            const extent = strip.children[0] as HTMLElement;
            const left = parseFloat(extent.style.left);
            const width = parseFloat(extent.style.width);
            expect(left).toBeGreaterThanOrEqual(0);
            expect(left + width).toBeLessThanOrEqual(100);

            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 160 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 196 });
            expect(strip.children).toHaveLength(1);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 196 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();

            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 100 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 160 });
            const preview = strip.children[1] as HTMLElement;
            expect(parseFloat(preview.style.left)).toBeCloseTo(50);
            expect(parseFloat(preview.style.width)).toBeCloseTo(10);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 160 });
            expect(mocks.setCompRegion).toHaveBeenCalledTimes(1);
            expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 7, endBeat: 8, takeId: 'take1' });
        });

        it('commits nothing when the swipe clamps to a sliver below the minimum span', () => {
            const strip = renderSwipePanel(makeTake({ id: 'take1', name: 'Take A', startBeat: 0, endBeat: 12 }), [
                makeClip({ id: 'c1', startBeat: 0, endBeat: 8 }),
            ]);
            // Strip spans 0..12 at 200px: beat 7.99 is 133.17px and beat 9 is 150px, so 0.01 beat survives the clip.
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 133.17 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            expect(strip.children).toHaveLength(1);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 150 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
        });

        it('shows no preview and commits nothing for a take with no source clip', () => {
            const strip = renderSwipePanel(
                makeTake({ id: 'take1', name: 'Take A', clipId: 'missing', endBeat: 8 }),
                clip0to8
            );
            expect((strip.children[0] as HTMLElement).style.width).toBe('100%');
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            expect(strip.children).toHaveLength(1);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 150 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
        });

        it('commits a chorded release once, at the move that reports the primary button gone', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, buttons: 1, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 1, button: 2, buttons: 3, clientX: 100 });
            fireEvent.pointerMove(strip, { pointerId: 1, button: 0, buttons: 2, clientX: 150 });
            expect(mocks.setCompRegion).toHaveBeenCalledTimes(1);
            expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 2, endBeat: 6, takeId: 'take1' });
            expect(strip.children).toHaveLength(1);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 2, buttons: 0, clientX: 190 });
            expect(mocks.setCompRegion).toHaveBeenCalledTimes(1);
        });

        it('drops the swipe without committing when it loses pointer capture', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            expect(strip.children).toHaveLength(2);
            fireEvent.lostPointerCapture(strip, { pointerId: 1 });
            expect(strip.children).toHaveLength(1);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 150 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
        });

        it('removes the drag preview on release and on cancel', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            expect(strip.children).toHaveLength(2);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 150 });
            expect(strip.children).toHaveLength(1);

            mocks.setCompRegion.mockClear();
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            fireEvent.pointerMove(strip, { pointerId: 1, buttons: 1, clientX: 150 });
            expect(strip.children).toHaveLength(2);
            fireEvent.pointerCancel(strip, { pointerId: 1 });
            expect(strip.children).toHaveLength(1);
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 150 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
        });

        it('ignores a swipe shorter than the minimum span', () => {
            const strip = renderSwipePanel(takeA0to8, clip0to8);
            fireEvent.pointerDown(strip, { ...PRIMARY_POINTER, clientX: 50 });
            fireEvent.pointerUp(strip, { pointerId: 1, button: 0, clientX: 52 });
            expect(mocks.setCompRegion).not.toHaveBeenCalled();
        });
    });
});
