import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeSend, setSend, setTrackOutput } from '#/modules/Arrangement/useCases';

import { useTracks } from '../../hooks/useTracks';
import { RoutingMatrix } from '../RoutingMatrix';

vi.mock('#/modules/Arrangement/useCases', () => ({
    setSend: vi.fn(),
    removeSend: vi.fn(),
    setTrackOutput: vi.fn(),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(),
}));

type Send = { busId: string; level: number; preFader: boolean };
type TrackFixture = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus' | 'folder' | 'master';
    color: string;
    sends: Send[];
    outputId: string;
};

const track = (over: Partial<TrackFixture> & Pick<TrackFixture, 'id' | 'name' | 'kind'>): TrackFixture => ({
    color: '#888',
    sends: [],
    outputId: 'master',
    ...over,
});

const mockTracks = (tracks: TrackFixture[]): void => {
    vi.mocked(useTracks).mockReturnValue({ tracks, selectedTrackId: null });
};

describe('RoutingMatrix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTracks([
            track({ id: 'src-1', name: 'Kick', kind: 'audio' }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);
    });

    it('renders one destination column per bus plus a Master column, excluding folders', () => {
        mockTracks([
            track({ id: 'src-1', name: 'Kick', kind: 'audio' }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
            track({ id: 'folder-1', name: 'Group Folder', kind: 'folder' }),
        ]);

        render(<RoutingMatrix />);

        // Drum Bus appears both as a destination column and (being a bus) a
        // source row, so assert at least one occurrence.
        expect(screen.getAllByText('Drum Bus').length).toBeGreaterThan(0);
        expect(screen.getByText('Master')).toBeInTheDocument();
        // A folder is never a routing endpoint anywhere in the app; it must not
        // appear as a destination column (nor as a source row).
        expect(screen.queryByText('Group Folder')).not.toBeInTheDocument();
    });

    it('includes bus tracks as source rows so bus sends are routable', () => {
        mockTracks([
            track({
                id: 'bus-1',
                name: 'Drum Bus',
                kind: 'bus',
                sends: [{ busId: 'bus-2', level: 0.5, preFader: false }],
            }),
            track({ id: 'bus-2', name: 'Reverb Bus', kind: 'bus' }),
        ]);

        render(<RoutingMatrix />);

        // The send FROM the Drum Bus row TO the Reverb Bus proves buses are rows.
        expect(screen.getByRole('button', { name: 'Disconnect send Drum Bus → Reverb Bus' })).toBeInTheDocument();
    });

    it('does not render a folder as a source row', () => {
        mockTracks([
            track({ id: 'folder-1', name: 'Group Folder', kind: 'folder' }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);

        render(<RoutingMatrix />);

        expect(screen.queryByText('Group Folder')).not.toBeInTheDocument();
    });

    it('reflects a real, non-unity send from the track read-model as a connected send cell', () => {
        mockTracks([
            track({
                id: 'src-1',
                name: 'Kick',
                kind: 'audio',
                sends: [{ busId: 'bus-1', level: 0.6, preFader: false }],
            }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);

        render(<RoutingMatrix />);

        const cell = screen.getByRole('button', { name: 'Disconnect send Kick → Drum Bus' });
        expect(cell.textContent).toBe('●');
        expect(cell).not.toBeDisabled();
    });

    it('dispatches setSend at unit level when a disconnected send cell is clicked', () => {
        render(<RoutingMatrix />);

        fireEvent.click(screen.getByRole('button', { name: 'Connect send Kick → Drum Bus' }));

        expect(setSend).toHaveBeenCalledTimes(1);
        expect(setSend).toHaveBeenCalledWith('src-1', 'bus-1', 1);
        expect(removeSend).not.toHaveBeenCalled();
    });

    it('removes a tuned send on disconnect and re-creates it fresh on reconnect (explicit round-trip)', () => {
        // Disconnect is an explicit removal, not a level-0 write, so a matrix
        // round-trip does not silently keep a muted phantom send around.
        mockTracks([
            track({
                id: 'src-1',
                name: 'Kick',
                kind: 'audio',
                sends: [{ busId: 'bus-1', level: 0.6, preFader: false }],
            }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);
        const { rerender } = render(<RoutingMatrix />);

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect send Kick → Drum Bus' }));
        expect(removeSend).toHaveBeenCalledTimes(1);
        expect(removeSend).toHaveBeenCalledWith('src-1', 'bus-1');
        expect(setSend).not.toHaveBeenCalled();

        // After the store drops the send, the cell is a fresh route-on at unity.
        mockTracks([
            track({ id: 'src-1', name: 'Kick', kind: 'audio' }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);
        rerender(<RoutingMatrix />);

        fireEvent.click(screen.getByRole('button', { name: 'Connect send Kick → Drum Bus' }));
        expect(setSend).toHaveBeenCalledTimes(1);
        expect(setSend).toHaveBeenCalledWith('src-1', 'bus-1', 1);
    });

    it('renders an output edge distinctly and does not stack a send where the output already routes', () => {
        // Kick's OUTPUT routes to Drum Bus. The cell must show the output edge
        // (distinct cyan ▸ glyph), be read-only, and never let a click add a
        // second, duplicate signal path via setSend.
        mockTracks([
            track({ id: 'src-1', name: 'Kick', kind: 'audio', outputId: 'bus-1' }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);

        render(<RoutingMatrix />);

        const outputCell = screen.getByRole('button', { name: 'Kick output routed to Drum Bus' });
        expect(outputCell.textContent).toBe('▸');
        expect(outputCell).toBeDisabled();

        fireEvent.click(outputCell);
        expect(setSend).not.toHaveBeenCalled();
        expect(removeSend).not.toHaveBeenCalled();
    });

    it('routes the track output to Master when a non-master output cell is clicked', () => {
        mockTracks([
            track({ id: 'src-1', name: 'Kick', kind: 'audio', outputId: 'bus-1' }),
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
        ]);

        render(<RoutingMatrix />);

        fireEvent.click(screen.getByRole('button', { name: 'Route Kick output to Master' }));

        expect(setTrackOutput).toHaveBeenCalledTimes(1);
        expect(setTrackOutput).toHaveBeenCalledWith('src-1', 'master');
    });

    it('shows the Master output cell as the current output and disables it when already routed to master', () => {
        render(<RoutingMatrix />);

        const masterCell = screen.getByRole('button', { name: 'Kick output routed to Master' });
        expect(masterCell).toBeDisabled();
        expect(masterCell.textContent).toBe('▸');
    });

    it('renders a dash for the self cell where a bus source meets its own destination column', () => {
        mockTracks([
            track({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
            track({ id: 'bus-2', name: 'Reverb Bus', kind: 'bus' }),
        ]);

        render(<RoutingMatrix />);

        // Drum Bus → Drum Bus is a self cell (dash), never a clickable route.
        expect(screen.queryByRole('button', { name: /Drum Bus → Drum Bus/ })).not.toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
});
