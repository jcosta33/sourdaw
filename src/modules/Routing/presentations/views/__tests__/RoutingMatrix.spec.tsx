import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { routingConnectionKey, routingMatrixStore } from '../../../stores/routingMatrixStore';
import { useTracks } from '../../hooks/useTracks';
import { RoutingMatrix } from '../RoutingMatrix';

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [
            { id: 'src-1', name: 'Kick', kind: 'audio', color: '#f00', sends: [], outputId: 'bus-1' },
            { id: 'bus-1', name: 'Drum Bus', kind: 'bus', color: '#0f0', sends: [], outputId: 'master' },
        ],
        selectedTrackId: null,
    })),
}));

describe('RoutingMatrix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                { id: 'src-1', name: 'Kick', kind: 'audio', color: '#f00', sends: [], outputId: 'bus-1' },
                { id: 'bus-1', name: 'Drum Bus', kind: 'bus', color: '#0f0', sends: [], outputId: 'master' },
            ],
            selectedTrackId: null,
        });
        routingMatrixStore.set({ connections: {} });
    });

    it('renders one destination column per bus plus a Master column', () => {
        render(<RoutingMatrix />);

        expect(screen.getByText('Drum Bus')).toBeInTheDocument();
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('renders a disconnected cell with a Connect aria-label for a source/dest pair', () => {
        render(<RoutingMatrix />);

        const cell = screen.getByRole('button', { name: 'Connect Kick → Drum Bus' });
        expect(cell).toBeInTheDocument();
        expect(cell.textContent).toBe('');
    });

    it('toggles a connection on click and reflects the new state in the cell and store', () => {
        render(<RoutingMatrix />);
        const cell = screen.getByRole('button', { name: 'Connect Kick → Drum Bus' });

        fireEvent.click(cell);

        const key = routingConnectionKey('src-1', 'bus-1');
        expect(routingMatrixStore.value?.connections[key]).toEqual({
            sourceId: 'src-1',
            destId: 'bus-1',
            level: 1.0,
        });
        const connectedCell = screen.getByRole('button', { name: 'Disconnect Kick → Drum Bus' });
        expect(connectedCell.textContent).toBe('●');
    });

    it('toggling twice removes the connection again', () => {
        render(<RoutingMatrix />);
        const cell = screen.getByRole('button', { name: 'Connect Kick → Drum Bus' });

        fireEvent.click(cell);
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect Kick → Drum Bus' }));

        const key = routingConnectionKey('src-1', 'bus-1');
        expect(routingMatrixStore.value?.connections[key]).toBeUndefined();
        expect(screen.getByRole('button', { name: 'Connect Kick → Drum Bus' })).toBeInTheDocument();
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
