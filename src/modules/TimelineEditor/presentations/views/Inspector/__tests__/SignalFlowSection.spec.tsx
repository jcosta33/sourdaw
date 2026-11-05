import { useState } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SignalFlowSection } from '../SignalFlowSection';

// Mock external dependencies
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ children, compact }: { children: React.ReactNode; compact?: boolean }) => (
        <div data-testid="header-band" data-compact={compact}>
            {children}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('#/modules/Routing/presentations/views', () => ({
    RoutingGraph: () => <div data-testid="routing-graph">Routing Graph</div>,
}));

const StatefulSignalFlow = ({ initial = false }: { initial?: boolean }) => {
    const [expanded, setExpanded] = useState(initial);
    return <SignalFlowSection expanded={expanded} onExpandedChange={setExpanded} />;
};

describe('SignalFlowSection', () => {
    it('should render without crashing', () => {
        render(<StatefulSignalFlow />);
        expect(screen.getByText('Signal Flow')).toBeInTheDocument();
    });

    it('should render header band', () => {
        render(<StatefulSignalFlow />);
        expect(screen.getByTestId('header-band')).toBeInTheDocument();
    });

    it('should render collapsed by default', () => {
        render(<StatefulSignalFlow />);
        expect(screen.queryByTestId('routing-graph')).not.toBeInTheDocument();
    });

    it('should expand when header is clicked', () => {
        render(<StatefulSignalFlow />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByTestId('routing-graph')).toBeInTheDocument();
    });

    it('should collapse when header is clicked again', () => {
        render(<StatefulSignalFlow />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByTestId('routing-graph')).toBeInTheDocument();
        fireEvent.click(button);
        expect(screen.queryByTestId('routing-graph')).not.toBeInTheDocument();
    });

    it('should toggle aria-expanded attribute', () => {
        render(<StatefulSignalFlow />);
        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('reports the toggled value to its owner and renders from the expanded prop', () => {
        const onExpandedChange = vi.fn();
        const { rerender } = render(<SignalFlowSection expanded={false} onExpandedChange={onExpandedChange} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onExpandedChange).toHaveBeenCalledWith(true);
        expect(screen.queryByTestId('routing-graph')).not.toBeInTheDocument();
        rerender(<SignalFlowSection expanded onExpandedChange={onExpandedChange} />);
        expect(screen.getByTestId('routing-graph')).toBeInTheDocument();
    });

    it('should render surface card when expanded', () => {
        render(<StatefulSignalFlow />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByTestId('surface-card')).toBeInTheDocument();
    });
});
