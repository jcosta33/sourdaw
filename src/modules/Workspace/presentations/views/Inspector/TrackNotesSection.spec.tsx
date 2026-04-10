import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackNotesSection } from './TrackNotesSection';
import type { Track } from '../../../models/TrackViewTypes';

// Mock external dependencies
const mockSetTrackNotes = vi.fn();
vi.mock('#/modules/Arrangement/useCases/setTrackGainPan', () => ({
    setTrackNotes: (...args: unknown[]) => mockSetTrackNotes(...args),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackColor: vi.fn(),
}));

vi.mock('#/components/daw/DawCompactTextarea', () => ({
    DawCompactTextarea: ({
        value,
        onChange,
        onBlur,
        placeholder,
        'aria-label': ariaLabel,
    }: {
        value: string;
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
        onBlur?: () => void;
        placeholder?: string;
        'aria-label'?: string;
    }) => (
        <textarea
            data-testid="textarea"
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            aria-label={ariaLabel}
        />
    ),
}));

vi.mock('../../components/Inspector/InsetPanel', () => ({
    InsetPanel: ({
        children,
        className,
    }: {
        children: React.ReactNode;
        className?: string;
    }) => (
        <div data-testid="inset-panel" className={className}>
            {children}
        </div>
    ),
}));

vi.mock('../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

describe('TrackNotesSection', () => {
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
        frozen: false,
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
        notes: 'Initial notes',
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

    it('should render without crashing', () => {
        render(<TrackNotesSection track={mockTrack} />);
        expect(screen.getByText('Notes')).toBeInTheDocument();
    });

    it('should render textarea with track notes', () => {
        render(<TrackNotesSection track={mockTrack} />);
        const textarea = screen.getByTestId('textarea');
        expect(textarea).toHaveValue('Initial notes');
    });

    it('should have placeholder text', () => {
        render(<TrackNotesSection track={mockTrack} />);
        expect(screen.getByPlaceholderText('Add notes…')).toBeInTheDocument();
    });

    it('should have aria-label with track name', () => {
        render(<TrackNotesSection track={mockTrack} />);
        const textarea = screen.getByTestId('textarea');
        expect(textarea).toHaveAttribute('aria-label', 'Notes for Test Track');
    });

    it('should update local state when typing', () => {
        render(<TrackNotesSection track={mockTrack} />);
        const textarea = screen.getByTestId('textarea');
        fireEvent.change(textarea, { target: { value: 'Updated notes' } });
        expect(textarea).toHaveValue('Updated notes');
    });

    it('should call setTrackNotes on blur when notes changed', () => {
        render(<TrackNotesSection track={mockTrack} />);
        const textarea = screen.getByTestId('textarea');
        fireEvent.change(textarea, { target: { value: 'Updated notes' } });
        fireEvent.blur(textarea);
        expect(mockSetTrackNotes).toHaveBeenCalledWith('track-1', 'Updated notes');
    });

    it('should not call setTrackNotes on blur when notes unchanged', () => {
        render(<TrackNotesSection track={mockTrack} />);
        const textarea = screen.getByTestId('textarea');
        fireEvent.blur(textarea);
        expect(mockSetTrackNotes).not.toHaveBeenCalled();
    });

    it('should render inset panel', () => {
        render(<TrackNotesSection track={mockTrack} />);
        expect(screen.getByTestId('inset-panel')).toBeInTheDocument();
    });
});
