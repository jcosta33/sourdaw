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

vi.mock('../../RoutingGraph', () => ({
    RoutingGraph: () => <div data-testid="routing-graph">Routing Graph</div>,
}));

describe('SignalFlowSection', () => {
    it('should render without crashing', () => {
        render(<SignalFlowSection />);
        expect(screen.getByText('Signal Flow')).toBeInTheDocument();
    });

    it('should render header band', () => {
        render(<SignalFlowSection />);
        expect(screen.getByTestId('header-band')).toBeInTheDocument();
    });

    it('should render collapsed by default', () => {
        render(<SignalFlowSection />);
        expect(screen.queryByTestId('routing-graph')).not.toBeInTheDocument();
    });

    it('should expand when header is clicked', () => {
        render(<SignalFlowSection />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByTestId('routing-graph')).toBeInTheDocument();
    });

    it('should collapse when header is clicked again', () => {
        render(<SignalFlowSection />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByTestId('routing-graph')).toBeInTheDocument();
        fireEvent.click(button);
        expect(screen.queryByTestId('routing-graph')).not.toBeInTheDocument();
    });

    it('should toggle aria-expanded attribute', () => {
        render(<SignalFlowSection />);
        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('should render surface card when expanded', () => {
        render(<SignalFlowSection />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByTestId('surface-card')).toBeInTheDocument();
    });
});
