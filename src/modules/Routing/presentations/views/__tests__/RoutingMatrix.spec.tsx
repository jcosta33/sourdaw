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

const trackList = (
    overrides: {
        kickSends?: { busId: string; level: number; preFader: boolean }[];
        kickOutputId?: string;
    } = {}
) => ({
    tracks: [
        {
            id: 'src-1',
            name: 'Kick',
            kind: 'audio' as const,
            color: '#f00',
            sends: overrides.kickSends ?? [],
            outputId: overrides.kickOutputId ?? 'master',
        },
        { id: 'bus-1', name: 'Drum Bus', kind: 'bus' as const, color: '#0f0', sends: [], outputId: 'master' },
    ],
    selectedTrackId: null,
});

describe('RoutingMatrix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useTracks).mockReturnValue(trackList());
    });

    it('renders one destination column per bus plus a Master column', () => {
        render(<RoutingMatrix />);

        expect(screen.getByText('Drum Bus')).toBeInTheDocument();
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('reflects real send state from the track read-model, not a parallel store', () => {
        vi.mocked(useTracks).mockReturnValue(
            trackList({ kickSends: [{ busId: 'bus-1', level: 0.8, preFader: false }] })
        );

        render(<RoutingMatrix />);

        const connectedCell = screen.getByRole('button', { name: 'Disconnect Kick → Drum Bus' });
        expect(connectedCell.textContent).toBe('●');
    });

    it('renders a disconnected bus cell when the track has no send to that bus', () => {
        render(<RoutingMatrix />);

        const cell = screen.getByRole('button', { name: 'Connect Kick → Drum Bus' });
        expect(cell).toBeInTheDocument();
        expect(cell.textContent).toBe('');
    });

    it('dispatches setSend at unit level when a disconnected bus cell is clicked', () => {
        render(<RoutingMatrix />);

        fireEvent.click(screen.getByRole('button', { name: 'Connect Kick → Drum Bus' }));

        expect(setSend).toHaveBeenCalledTimes(1);
        expect(setSend).toHaveBeenCalledWith('src-1', 'bus-1', 1);
        expect(removeSend).not.toHaveBeenCalled();
    });

    it('dispatches removeSend when a connected bus cell is clicked', () => {
        vi.mocked(useTracks).mockReturnValue(
            trackList({ kickSends: [{ busId: 'bus-1', level: 0.8, preFader: false }] })
        );

        render(<RoutingMatrix />);

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect Kick → Drum Bus' }));

        expect(removeSend).toHaveBeenCalledTimes(1);
        expect(removeSend).toHaveBeenCalledWith('src-1', 'bus-1');
        expect(setSend).not.toHaveBeenCalled();
    });

    it('routes the track output to Master when a non-master output cell is clicked', () => {
        vi.mocked(useTracks).mockReturnValue(trackList({ kickOutputId: 'bus-1' }));

        render(<RoutingMatrix />);

        const masterCell = screen.getByRole('button', { name: 'Route Kick output to Master' });
        fireEvent.click(masterCell);

        expect(setTrackOutput).toHaveBeenCalledTimes(1);
        expect(setTrackOutput).toHaveBeenCalledWith('src-1', 'master');
    });

    it('shows the Master output cell as the current output and disables it when already routed to master', () => {
        render(<RoutingMatrix />);

        const masterCell = screen.getByRole('button', { name: 'Kick output routed to Master' });
        expect(masterCell).toBeDisabled();
        expect(masterCell.textContent).toBe('●');
    });

    it('renders a dash instead of a toggle button when a source id collides with a destination id', () => {
        // Regression guard: destinations always include the synthetic "master"
        // column, so a data artifact where a non-bus track carries id "master"
        // must still render as a self cell (dash), never a clickable route.
        vi.mocked(useTracks).mockReturnValue({
            tracks: [{ id: 'master', name: 'Stray Master', kind: 'audio', color: '#fff', sends: [], outputId: '' }],
            selectedTrackId: null,
        });

        render(<RoutingMatrix />);

        expect(screen.queryByRole('button', { name: /Stray Master → Master/ })).not.toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
    });
});
