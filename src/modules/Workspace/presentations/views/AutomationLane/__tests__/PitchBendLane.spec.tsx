import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PitchBendLane } from '../PitchBendLane';

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
    midiStore: { value: { pitchBendByClipId: {} } },
}));

vi.mock('#/modules/Command/useCases/pushUndoEntry', () => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/addPitchBend', () => ({
    addPitchBend: vi.fn(() => ({ id: 'pb-1', value: 64, beat: 0 })),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/removePitchBend', () => ({
    removePitchBend: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiEvent/movePitchBend', () => ({
    movePitchBend: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    })),
}));

vi.mock('../../../helpers/laneConstants', () => ({
    PITCH_BEND_CENTER: 64,
}));

describe('PitchBendLane', () => {
    const defaultProps = {
        clipId: 'clip-1',
        beatWidth: 40,
        contentWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing with clipId', () => {
        render(<PitchBendLane {...defaultProps} />);
        expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('should render blocked state when clipId is null', () => {
        render(<PitchBendLane {...defaultProps} clipId={null} />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
        expect(screen.getByText('No clip selected')).toBeInTheDocument();
    });

    it('should render with correct aria-label', () => {
        render(<PitchBendLane {...defaultProps} />);
        expect(screen.getByLabelText('Pitch bend automation lane')).toBeInTheDocument();
    });

    it('should render add hint when no points exist', () => {
        render(<PitchBendLane {...defaultProps} />);
        expect(screen.getByText(/Click to add pitch bend points/)).toBeInTheDocument();
    });
});
