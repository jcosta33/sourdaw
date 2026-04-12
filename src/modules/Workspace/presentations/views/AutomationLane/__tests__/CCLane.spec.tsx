import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CCLane } from '../CCLane';

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title, description }: { title: string; description: string }) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {classes.push(key);}
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: { value: { ccByClipId: {} } },
}));

vi.mock('#/modules/Command/useCases/pushUndoEntry', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/addMidiCC', () => ({
    addMidiCC: vi.fn(() => ({ id: 'cc-1', controller: 1, value: 64, beat: 0 })),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/removeMidiCC', () => ({
    removeMidiCC: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/moveMidiCC', () => ({
    moveMidiCC: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    })),
}));

describe('CCLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        controller: 1,
        beatWidth: 40,
        contentWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing with clipId', () => {
        render(<CCLane {...defaultProps} />);
        expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('should render blocked state when clipId is null', () => {
        render(<CCLane {...defaultProps} clipId={null} />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
        expect(screen.getByText('No clip selected')).toBeInTheDocument();
    });

    it('should render with correct aria-label', () => {
        render(<CCLane {...defaultProps} />);
        expect(screen.getByLabelText('CC 1 automation lane')).toBeInTheDocument();
    });

    it('should render add hint when no points exist', () => {
        render(<CCLane {...defaultProps} />);
        expect(screen.getByText('Click to add CC points')).toBeInTheDocument();
    });
});
