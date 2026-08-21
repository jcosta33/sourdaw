import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackHeaderSection } from '../TrackHeaderSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockRenameTrack = vi.fn();
const mockSetTrackColor = vi.fn();
const mockFreezeTrack = vi.fn();
const mockUnfreezeTrack = vi.fn();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        renameTrack: (...args: unknown[]) => mockRenameTrack(...args),
        setTrackNotes: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackColor: (...args: unknown[]) => mockSetTrackColor(...args),
        unfreezeTrack: (...args: unknown[]) => mockUnfreezeTrack(...args),
        freezeTrack: (...args: unknown[]) => mockFreezeTrack(...args),
    };
});

vi.mock('#/components/daw/DawCompactInput', () => ({
    DawCompactInput: ({
        value,
        onChange,
        onBlur,
        onKeyDown,
        autoFocus,
    }: {
        value: string;
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onBlur?: () => void;
        onKeyDown?: (e: React.KeyboardEvent) => void;
        autoFocus?: boolean;
    }) => (
        <input
            data-testid="compact-input"
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
        />
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        'aria-pressed': ariaPressed,
        'aria-label': ariaLabel,
        title,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string }) => (
        <button
            type="button"
            data-testid="button"
            data-variant={variant}
            data-pressed={ariaPressed}
            aria-pressed={ariaPressed}
            aria-label={ariaLabel}
            title={title}
            onClick={onClick}
            {...props}
        >
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/InsetPanel', () => ({
    InsetPanel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div data-testid="inset-panel" className={className}>
            {children}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

vi.mock('#/utils/UI/colorPresets', () => ({
    TRACK_COLOR_PRESETS: ['#ff0000', '#00ff00', '#0000ff'],
}));

describe('TrackHeaderSection', () => {
    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' as const },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 100,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null for master track', () => {
        const masterTrack = { ...mockTrack, kind: 'master' as const };
        const { container } = render(<TrackHeaderSection track={masterTrack} />);
        expect(container.firstChild).toBeNull();
    });

    it('should render without crashing', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        expect(screen.getByTestId('inset-panel')).toBeInTheDocument();
    });

    it('should display track name', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should enter edit mode when name is clicked', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        const nameButton = screen.getByText('Test Track');
        fireEvent.click(nameButton);
        expect(screen.getByTestId('compact-input')).toBeInTheDocument();
    });

    it('should show track kind', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        expect(screen.getByText('Kind:')).toBeInTheDocument();
        expect(screen.getByText('audio')).toBeInTheDocument();
    });

    it('should render freeze button', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        expect(screen.getByText(/Freeze/i)).toBeInTheDocument();
    });

    it('should show Unfreeze for frozen tracks', () => {
        const frozenTrack = { ...mockTrack, frozen: true, freezeState: { status: 'frozen' as const } };
        render(<TrackHeaderSection track={frozenTrack} />);
        expect(screen.getByText(/Unfreeze/i)).toBeInTheDocument();
    });

    it('should not render freeze button for folder tracks', () => {
        const folderTrack = { ...mockTrack, kind: 'folder' as const };
        render(<TrackHeaderSection track={folderTrack} />);
        expect(screen.queryByText(/Freeze|Unfreeze/i)).not.toBeInTheDocument();
    });

    it('should render color picker', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        expect(screen.getByText('Color')).toBeInTheDocument();
    });

    it('should render color preset buttons', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        const colorButtons = screen.getAllByLabelText(/Set color/i);
        expect(colorButtons.length).toBe(3);
    });

    it('should call setTrackColor when color is selected', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        const colorButtons = screen.getAllByLabelText(/Set color/i);
        const secondColorButton = colorButtons[1];
        if (!secondColorButton) {
            throw new Error('expected a second color preset button');
        }
        fireEvent.click(secondColorButton);
        expect(mockSetTrackColor).toHaveBeenCalledWith('track-1', '#00ff00');
    });

    it('marks the active color preset aria-pressed true and others false', () => {
        render(<TrackHeaderSection track={mockTrack} />);
        // mockTrack.color is '#ff0000' — the first preset.
        const colorButtons = screen.getAllByLabelText(/Set color/i);
        expect(colorButtons[0]).toHaveAttribute('aria-pressed', 'true');
        expect(colorButtons[1]).toHaveAttribute('aria-pressed', 'false');
    });
});
