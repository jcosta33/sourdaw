import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Send, type Track } from '../../../models/TrackViewTypes';
import { RoutingGraph } from '../RoutingGraph';

type RoutingTrackState = { tracks: Track[]; selectedTrackId: string | null };
type RoutingSidechainState = { routes: { id: string; sourceTrackId: string; targetTrackId: string }[] };

type Mocks = {
    trackState: RoutingTrackState;
    sidechainState: RoutingSidechainState;
    selectTrack: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted((): Mocks => ({
    trackState: { tracks: [], selectedTrackId: null },
    sidechainState: { routes: [] },
    selectTrack: vi.fn(),
}));

// Both stores are read via `useStore(store, default)` directly (no shared
// hook), so the mock below tags each store with an `__id` and branches on it —
// the pattern already used for multi-store views (see ModulationMatrix.spec.tsx).
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { __id: 'track' },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    selectTrack: mocks.selectTrack,
}));

vi.mock('../../../stores/sidechainStore', () => ({
    sidechainStore: { __id: 'sidechain' },
    defaultSidechainStoreState: { routes: [] },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { __id?: string }, defaultValue: unknown) => {
        if (store.__id === 'track') {
            return mocks.trackState;
        }
        if (store.__id === 'sidechain') {
            return mocks.sidechainState;
        }
        return defaultValue;
    }),
}));

function track(overrides: Partial<Track> & { id: string }): Track {
    return { name: overrides.id, kind: 'audio', color: '#123456', sends: [], outputId: 'master', ...overrides };
}

function send(overrides: Partial<Send> & { busId: string }): Send {
    return { level: 1, preFader: false, ...overrides };
}

describe('RoutingGraph', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackState = { tracks: [], selectedTrackId: null };
        mocks.sidechainState = { routes: [] };
    });

    it('renders the empty state when there are no tracks', () => {
        render(<RoutingGraph />);

        expect(screen.getByText('No routing to display')).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'Signal routing graph' })).not.toBeInTheDocument();
    });

    it('renders one node per track and truncates long names', () => {
        mocks.trackState = {
            tracks: [
                track({ id: 't1', name: 'Kick' }),
                track({ id: 't2', name: 'A Very Long Track Name Indeed', outputId: 'master' }),
            ],
            selectedTrackId: null,
        };

        render(<RoutingGraph />);

        expect(screen.getAllByRole('button')).toHaveLength(2);
        expect(screen.getByText('Kick')).toBeInTheDocument();
        expect(screen.getByText('A Very Long…')).toBeInTheDocument();
    });

    it('skips the output connection when the destination cannot be resolved and there is no master', () => {
        mocks.trackState = {
            tracks: [track({ id: 't1', name: 'Orphan', outputId: 'nowhere' })],
            selectedTrackId: null,
        };

        const { container } = render(<RoutingGraph />);

        expect(container.querySelectorAll('path')).toHaveLength(0);
    });

    it('renders send connections only for positive levels resolvable to a real bus, labelled with level and pre-fader flag', () => {
        mocks.trackState = {
            tracks: [
                track({
                    id: 'src',
                    name: 'Source',
                    outputId: 'bus',
                    sends: [
                        send({ busId: 'bus', level: 0.3, preFader: true }),
                        send({ busId: 'bus', level: 0 }), // filtered: level is 0
                        send({ busId: 'ghost', level: 0.9 }), // filtered: no such bus
                    ],
                }),
                track({ id: 'bus', name: 'Bus', kind: 'bus', outputId: 'master' }),
                track({ id: 'master', name: 'Master', kind: 'master', outputId: 'hw_out' }),
            ],
            selectedTrackId: null,
        };

        const { container } = render(<RoutingGraph />);

        // One output connection (src -> bus, bus -> master) plus exactly one send line.
        expect(container.querySelectorAll('path')).toHaveLength(3);
        expect(screen.getByText('30% pre')).toBeInTheDocument();
    });

    it('renders a sidechain connection between the routed tracks', () => {
        mocks.trackState = {
            tracks: [
                track({ id: 'a', name: 'A', outputId: 'master' }),
                track({ id: 'b', name: 'B', outputId: 'master' }),
                track({ id: 'master', name: 'Master', kind: 'master', outputId: 'hw_out' }),
            ],
            selectedTrackId: null,
        };
        mocks.sidechainState = { routes: [{ id: 'sc1', sourceTrackId: 'a', targetTrackId: 'b' }] };

        const { container } = render(<RoutingGraph />);

        // 2 output connections (a -> master, b -> master) + 1 sidechain connection.
        expect(container.querySelectorAll('path')).toHaveLength(3);
        expect(container.querySelectorAll('path[stroke-dasharray="2 3"]')).toHaveLength(1);
    });

    it('highlights connections that touch the selected track and leaves unrelated ones dim', () => {
        mocks.trackState = {
            tracks: [
                track({ id: 'kick', name: 'Kick', outputId: 'drums-bus' }),
                track({ id: 'drums-bus', name: 'Drums Bus', kind: 'bus', outputId: 'master' }),
                track({ id: 'util-bus', name: 'Util Bus', kind: 'bus', outputId: 'master' }),
                track({ id: 'master', name: 'Master', kind: 'master', outputId: 'hw_out' }),
            ],
            selectedTrackId: 'kick',
        };

        const { container } = render(<RoutingGraph />);

        // kick -> drums-bus and drums-bus -> master both touch the selected
        // track (directly, then via its resolved output), util-bus -> master
        // touches neither.
        expect(container.querySelectorAll('path[opacity="1"]')).toHaveLength(2);
        expect(container.querySelectorAll('path[opacity="0.5"]')).toHaveLength(1);
    });

    it('marks the selected node with a thicker stroke than unselected nodes', () => {
        mocks.trackState = {
            tracks: [
                track({ id: 't1', name: 'Selected', outputId: 'master' }),
                track({ id: 't2', name: 'Other', outputId: 'master' }),
            ],
            selectedTrackId: 't1',
        };

        const { container } = render(<RoutingGraph />);

        expect(container.querySelectorAll('rect[stroke-width="2"]')).toHaveLength(1);
        expect(container.querySelectorAll('rect[stroke-width="1"]')).toHaveLength(1);
    });

    it('selects a track on click and on Enter/Space keydown', () => {
        mocks.trackState = {
            tracks: [track({ id: 't1', name: 'Kick', outputId: 'master' })],
            selectedTrackId: null,
        };

        render(<RoutingGraph />);
        const node = screen.getByRole('button', { name: 'Select Kick' });

        fireEvent.click(node);
        expect(mocks.selectTrack).toHaveBeenCalledWith('t1');

        mocks.selectTrack.mockClear();
        fireEvent.keyDown(node, { key: 'Enter' });
        expect(mocks.selectTrack).toHaveBeenCalledWith('t1');

        mocks.selectTrack.mockClear();
        fireEvent.keyDown(node, { key: ' ' });
        expect(mocks.selectTrack).toHaveBeenCalledWith('t1');
    });
});
