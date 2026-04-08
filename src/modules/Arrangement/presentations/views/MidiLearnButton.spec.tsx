import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MidiLearnButton } from './MidiLearnButton';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        mappings: [],
        isLearning: false,
        learningTarget: null,
    })),
}));

vi.mock('#/modules/MIDI/stores/midiLearnStore', () => ({
    midiLearnStore: {},
}));

vi.mock('#/modules/MIDI/useCases/midiLearn', () => ({
    startMidiLearn: vi.fn(),
    stopMidiLearn: vi.fn(),
    findMappingForTarget: vi.fn(() => null),
}));

let mockMidiState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

vi.mocked(vi.importMock('#/infra/store/useStore').useStore).mockImplementation(() => mockMidiState);

describe('MidiLearnButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMidiState = {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
    });

    it('should render without crashing', () => {
        const { container } = render(
            <MidiLearnButton targetType="deviceParam" trackId="track1" deviceId="dev1" paramId="param1" />
        );
        expect(container.firstChild).toBeTruthy();
    });

    it('should display "M" when no mapping exists', () => {
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" />);
        expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('should display mapped CC number when mapping exists', () => {
        const { findMappingForTarget } = vi.importMock('#/modules/MIDI/useCases/midiLearn');
        findMappingForTarget.mockReturnValue({
            id: 'm1',
            channel: 1,
            cc: 7,
            targetType: 'deviceParam',
            trackId: 'track1',
            paramId: 'param1',
        });
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('should call startMidiLearn when clicked and not learning', () => {
        const { startMidiLearn } = vi.importMock('#/modules/MIDI/useCases/midiLearn');
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(startMidiLearn).toHaveBeenCalledWith({
            targetType: 'deviceParam',
            trackId: 'track1',
            paramId: 'param1',
            deviceId: undefined,
        });
    });

    it('should call stopMidiLearn when clicked while learning this target', () => {
        const { stopMidiLearn } = vi.importMock('#/modules/MIDI/useCases/midiLearn');
        mockMidiState = {
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'deviceParam',
                trackId: 'track1',
                paramId: 'param1',
            },
        };
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(stopMidiLearn).toHaveBeenCalled();
    });

    it('should show tooltip with "MIDI Learn" label', () => {
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" />);
        expect(screen.getByLabelText('MIDI Learn')).toBeInTheDocument();
    });

    it('should show tooltip with mapped CC info', () => {
        const { findMappingForTarget } = vi.importMock('#/modules/MIDI/useCases/midiLearn');
        findMappingForTarget.mockReturnValue({
            id: 'm1',
            channel: 0,
            cc: 1,
            targetType: 'deviceParam',
            trackId: 'track1',
            paramId: 'param1',
        });
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        expect(screen.getByLabelText(/MIDI CC 1/)).toBeInTheDocument();
    });

    it('should stop propagation on click', () => {
        const mockStopPropagation = vi.fn();
        render(<MidiLearnButton targetType="deviceParam" trackId="track1" />);
        const button = screen.getByRole('button');
        fireEvent.click(button, { stopPropagation: mockStopPropagation });
    });
});
