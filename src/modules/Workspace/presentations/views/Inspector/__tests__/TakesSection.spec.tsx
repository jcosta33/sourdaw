import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TakesSection } from '../TakesSection';

// Mock external dependencies
const mockSelectTake = vi.fn();
vi.mock('#/modules/Arrangement/useCases/comping/selectTake', () => ({
    selectTake: (...args: unknown[]) => mockSelectTake(...args),
}));

const mockSetCompRegion = vi.fn();
vi.mock('#/modules/Arrangement/useCases/comping/setCompRegion', () => ({
    setCompRegion: (...args: unknown[]) => mockSetCompRegion(...args),
}));

const mockFlattenComp = vi.fn();
vi.mock('#/modules/Arrangement/useCases/comping/flattenComp', () => ({
    flattenComp: (...args: unknown[]) => mockFlattenComp(...args),
}));

const mockUseStore = vi.fn(() => ({ lanes: [] }));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawMicroBadge', () => ({
    DawMicroBadge: ({ children, tone }: { children: React.ReactNode; tone?: string }) => (
        <span data-testid="micro-badge" data-tone={tone}>
            {children}
        </span>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, variant }: { children: React.ReactNode; onClick?: () => void; variant?: string }) => (
        <button data-testid="button" data-variant={variant} onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/ChoiceCard', () => ({
    ChoiceCard: ({
        children,
        selected,
        onClick,
    }: {
        children: React.ReactNode;
        selected?: boolean;
        onClick?: () => void;
    }) => (
        <div data-testid="choice-card" data-selected={selected} onClick={onClick}>
            {children}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

describe('TakesSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null when no takes exist for track', () => {
        mockUseStore.mockReturnValue({ lanes: [] });
        const { container } = render(<TakesSection trackId="track-1" />);
        expect(container.firstChild).toBeNull();
    });

    it('should return null when lane has no takes', () => {
        mockUseStore.mockReturnValue({ lanes: [{ trackId: 'track-1', takes: [] }] });
        const { container } = render(<TakesSection trackId="track-1" />);
        expect(container.firstChild).toBeNull();
    });

    it('should render without crashing when takes exist', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [{ id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true }],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        expect(screen.getByText('Takes (1)')).toBeInTheDocument();
    });

    it('should display take count in header', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [
                        { id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true },
                        { id: 'take-2', name: 'Take 2', startBeat: 16, endBeat: 32, selected: false },
                    ],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        expect(screen.getByText('Takes (2)')).toBeInTheDocument();
    });

    it('should display take names', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [{ id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true }],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        expect(screen.getByText('Take 1')).toBeInTheDocument();
    });

    it('should display beat range for takes', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [{ id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true }],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        expect(screen.getByText(/beat 0–16/)).toBeInTheDocument();
    });

    it('should show active badge for selected take', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [{ id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true }],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('should show set active button for non-selected takes', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [
                        { id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true },
                        { id: 'take-2', name: 'Take 2', startBeat: 16, endBeat: 32, selected: false },
                    ],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        expect(screen.getByText('Set Active')).toBeInTheDocument();
    });

    it('should call selectTake and setCompRegion when set active is clicked', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [
                        { id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true },
                        { id: 'take-2', name: 'Take 2', startBeat: 16, endBeat: 32, selected: false },
                    ],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        const setActiveButton = screen.getByText('Set Active');
        fireEvent.click(setActiveButton);
        expect(mockSelectTake).toHaveBeenCalledWith('track-1', 'take-2');
        expect(mockSetCompRegion).toHaveBeenCalledWith('track-1', { takeId: 'take-2', startBeat: 16, endBeat: 32 });
    });

    it('should call flattenComp when flatten button is clicked', () => {
        mockUseStore.mockReturnValue({
            lanes: [
                {
                    trackId: 'track-1',
                    takes: [{ id: 'take-1', name: 'Take 1', startBeat: 0, endBeat: 16, selected: true }],
                },
            ],
        });
        render(<TakesSection trackId="track-1" />);
        const flattenButton = screen.getByText('Flatten');
        fireEvent.click(flattenButton);
        expect(mockFlattenComp).toHaveBeenCalledWith('track-1');
    });
});
