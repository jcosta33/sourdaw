import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { normalizeTrack } from '../../../models/Track';
import { TakeLanePanel, TakeLanesView } from '../TakeLanesView';

import type { Clip, Track } from '../../../models/Track';
import type { Take, TakeLane } from '../../../models/TakeLane';
import type { TakeLaneStoreState } from '../../../stores/takeLaneStore';
import type { TrackStoreState } from '../../../stores/trackStore';

type GetTakeLaneForTrackMock = (trackId: string) => TakeLane | null;

const mocks = vi.hoisted(() => ({
    laneState: { lanes: [] } as TakeLaneStoreState,
    trackState: { tracks: [], selectedTrackId: null } as TrackStoreState,
    addTake: vi.fn(),
    addTakeLane: vi.fn(),
    flattenComp: vi.fn(),
    getTakeLaneForTrack: vi.fn<GetTakeLaneForTrackMock>(),
    removeCompRegion: vi.fn(),
    selectTake: vi.fn(),
    setCompRegion: vi.fn(),
}));

vi.mock('../../../stores/takeLaneStore', () => ({ takeLaneStore: 'take-lane-store' }));
vi.mock('../../../stores/trackStore', () => ({ trackStore: 'track-store' }));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: unknown, defaultValue: unknown) => {
        if (store === 'take-lane-store') {
            return mocks.laneState;
        }
        if (store === 'track-store') {
            return mocks.trackState;
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

const stripRect = { width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0, toJSON: () => {} };

function resetMocks(): void {
    vi.clearAllMocks();
    mocks.laneState = { lanes: [] };
    mocks.trackState = { tracks: [], selectedTrackId: null };
    mocks.getTakeLaneForTrack.mockReturnValue(null);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(stripRect);
}

describe('TakeLanesView', () => {
    beforeEach(resetMocks);
    afterEach(() => vi.restoreAllMocks());

    it('shows the enablement hint when no track has variation lanes toggled on', () => {
        mocks.trackState = {
            tracks: [makeTrack({ id: 't1', name: 'Drums', kind: 'audio', showVariationLanes: false })],
            selectedTrackId: null,
        };
        render(<TakeLanesView />);
        expect(screen.getByText(/toggle "variation lanes"/i)).toBeInTheDocument();
    });

    it('renders one panel per eligible track and excludes master/folder tracks even when toggled on', () => {
        mocks.trackState = {
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

    const renderPanel = (trackId = 't1') => render(<TakeLanePanel trackId={trackId} trackName="Vox" trackColor="#4de" />);

    it('reports the track as missing when it is absent from the track store', () => {
        renderPanel('missing');
        expect(screen.getByText('Track not found.')).toBeInTheDocument();
    });

    it('shows pluralized take and comp region counts from the lane state', () => {
        mocks.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        mocks.laneState = {
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

    it('initializes a lane and adds a take from the first clip when "Add take" is clicked with no lane yet', () => {
        mocks.trackState = {
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
    });

    it('adds a synthetic take spanning the clip-derived range when the track has no clips', () => {
        mocks.trackState = {
            tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio', clips: [] })],
            selectedTrackId: null,
        };
        mocks.getTakeLaneForTrack.mockReturnValue({ id: 'lane1', trackId: 't1', takes: [], activeCompRegions: [] });
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Add take' }));
        expect(mocks.addTakeLane).not.toHaveBeenCalled();
        expect(mocks.addTake).toHaveBeenCalledWith('t1', 't1-synthetic', 'Take 1', 0, 16);
    });

    it('initializes a take lane from the "Lane" button only while none exists, and hides it once one does', () => {
        mocks.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        const { rerender } = renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Initialize take lane' }));
        expect(mocks.addTakeLane).toHaveBeenCalledWith('t1');

        mocks.laneState = { lanes: [{ id: 'lane1', trackId: 't1', takes: [], activeCompRegions: [] }] };
        rerender(<TakeLanePanel trackId="t1" trackName="Vox" trackColor="#4de" />);
        expect(screen.queryByRole('button', { name: 'Initialize take lane' })).not.toBeInTheDocument();
    });

    it('disables Flatten without a lane and calls flattenComp once a lane exists', () => {
        mocks.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        const { rerender } = renderPanel();
        expect(screen.getByRole('button', { name: 'Flatten comp' })).toBeDisabled();

        mocks.laneState = { lanes: [{ id: 'lane1', trackId: 't1', takes: [], activeCompRegions: [] }] };
        rerender(<TakeLanePanel trackId="t1" trackName="Vox" trackColor="#4de" />);
        fireEvent.click(screen.getByRole('button', { name: 'Flatten comp' }));
        expect(mocks.flattenComp).toHaveBeenCalledWith('t1');
    });

    it('promotes a take to the active take when its row toggle is clicked', () => {
        mocks.trackState = { tracks: [makeTrack({ id: 't1', name: 'Vox', kind: 'audio' })], selectedTrackId: null };
        mocks.laneState = {
            lanes: [
                { id: 'lane1', trackId: 't1', takes: [makeTake({ id: 'take1', name: 'Take A' })], activeCompRegions: [] },
            ],
        };
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Promote Take A to main take' }));
        expect(mocks.selectTake).toHaveBeenCalledWith('t1', 'take1');
    });

    it('creates a comp region spanning the beats dragged across the take row', () => {
        mocks.trackState = {
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
        mocks.laneState = {
            lanes: [
                { id: 'lane1', trackId: 't1', takes: [makeTake({ id: 'take1', name: 'Take A' })], activeCompRegions: [] },
            ],
        };
        const { container } = renderPanel();
        const row = container.querySelector('[role="presentation"]')!;
        fireEvent.mouseDown(row, { button: 0, clientX: 50 });
        fireEvent.mouseMove(row, { clientX: 150 });
        fireEvent.mouseUp(row);
        expect(mocks.setCompRegion).toHaveBeenCalledWith('t1', { startBeat: 2, endBeat: 6, takeId: 'take1' });
    });

    it('removes a comp region when its overlay trash button is clicked', () => {
        mocks.trackState = {
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
        mocks.laneState = {
            lanes: [
                {
                    id: 'lane1',
                    trackId: 't1',
                    takes: [makeTake({ id: 'take1', name: 'Take A' })],
                    activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: 'take1' }],
                },
            ],
        };
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Remove comp region Take A' }));
        expect(mocks.removeCompRegion).toHaveBeenCalledWith('t1', 2);
    });
});
