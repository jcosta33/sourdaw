import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VirtualKeyboard } from './VirtualKeyboard';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        virtualKeyboardOctave: 4,
        virtualKeyboardVelocity: 100,
    })),
}));

vi.mock('#/modules/AudioEngine/useCases/triggerLiveNoteOn', () => ({
    triggerLiveNoteOn: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/triggerLiveNoteOff', () => ({
    triggerLiveNoteOff: vi.fn(),
}));

vi.mock(
    '#/modules/Workspace/useCases/togglePanel/panelToggles/setVirtualKeyboardVelocity',
    () => ({
        setVirtualKeyboardVelocity: vi.fn(),
    }),
);

vi.mock(
    '#/modules/Workspace/useCases/togglePanel/panelToggles/setVirtualKeyboardOctave',
    () => ({
        setVirtualKeyboardOctave: vi.fn(),
    }),
);

// Mock UI components
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions, children }: any) => (
        <div data-testid="daw-header-band">
            <span>{title}</span>
            {children}
            {actions}
        </div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="daw-control-strip">{children}</div>
    ),
}));

vi.mock('#/components/daw/DawDisplaySurface', () => ({
    DawDisplaySurface: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="daw-display-surface">{children}</div>
    ),
}));

vi.mock('#/components/daw/DawInlineHint', () => ({
    DawInlineHint: ({ children }: { children: React.ReactNode }) => (
        <span data-testid="daw-inline-hint">{children}</span>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, 'aria-label': ariaLabel }: any) => (
        <button onClick={onClick} aria-label={ariaLabel}>{children}</button>
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, onValueChange }: any) => (
        <input 
            type="range" 
            value={value?.[0] || 0} 
            onChange={(e) => onValueChange?.([Number(e.target.value)])}
            data-testid="velocity-slider"
        />
    ),
}));

describe('VirtualKeyboard', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-header-band')).toBeInTheDocument();
    });

    it('should display virtual keyboard title', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByText(/Virtual keyboard/i)).toBeInTheDocument();
    });

    it('should render control strip', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-control-strip')).toBeInTheDocument();
    });

    it('should render display surface', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-display-surface')).toBeInTheDocument();
    });

    it('should display octave controls', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByLabelText(/Octave down/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Octave up/i)).toBeInTheDocument();
    });

    it('should display current octave', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should render close button when onClose is provided', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByLabelText(/Close virtual keyboard/i)).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        const closeButton = screen.getByLabelText(/Close virtual keyboard/i);
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should render without close button when onClose is not provided', () => {
        render(<VirtualKeyboard />);
        expect(screen.queryByLabelText(/Close virtual keyboard/i)).not.toBeInTheDocument();
    });

    it('should render keyboard hint', () => {
        render(<VirtualKeyboard onClose={mockOnClose} />);
        expect(screen.getByTestId('daw-inline-hint')).toBeInTheDocument();
    });
});
