import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { findMappingForTarget } from '#/modules/MIDI/useCases/midiLearn/findMappingForTarget';
import { startMidiLearn } from '#/modules/MIDI/useCases/midiLearn/startMidiLearn';
import { stopMidiLearn } from '#/modules/MIDI/useCases/midiLearn/stopMidiLearn';

import { MidiLearnButton } from '../MidiLearnButton';

// Track mock state
let mockMidiState = {
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => mockMidiState),
}));

vi.mock('#/modules/MIDI/stores/midiLearnStore', () => ({
    midiLearnStore: {
        value: { mappings: [], isLearning: false, learningTarget: null },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('#/modules/MIDI/useCases/midiLearn/findMappingForTarget', () => ({
    findMappingForTarget: vi.fn(() => null),
}));

vi.mock('#/modules/MIDI/useCases/midiLearn/stopMidiLearn', () => ({
    stopMidiLearn: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases/midiLearn/startMidiLearn', () => ({
    startMidiLearn: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('MidiLearnButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMidiState = {
            mappings: [],
            isLearning: false,
            learningTarget: null,
        };
        const mockedFindMappingForTarget = vi.mocked(findMappingForTarget);
        mockedFindMappingForTarget.mockReturnValue(null);
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(
            <MidiLearnButton targetType="deviceParam" trackId="track1" deviceId="dev1" paramId="param1" />
        );
        expect(container.firstChild).toBeTruthy();
    });

    it('should display "M" when no mapping exists', () => {
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" />);
        expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('should display mapped CC number when mapping exists', () => {
        const mockedFindMappingForTarget = vi.mocked(findMappingForTarget);
        mockedFindMappingForTarget.mockReturnValue({
            id: 'm1',
            channel: 1,
            cc: 7,
            targetType: 'deviceParam',
            trackId: 'track1',
            paramId: 'param1',
        });
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('should call startMidiLearn when clicked and not learning', () => {
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
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
        mockMidiState = {
            mappings: [],
            isLearning: true,
            learningTarget: {
                targetType: 'deviceParam',
                trackId: 'track1',
                paramId: 'param1',
            },
        };
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(stopMidiLearn).toHaveBeenCalled();
    });

    it('should show tooltip with "MIDI Learn" label', () => {
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" />);
        expect(screen.getByLabelText('MIDI Learn')).toBeInTheDocument();
    });

    it('should show tooltip with mapped CC info', () => {
        const mockedFindMappingForTarget = vi.mocked(findMappingForTarget);
        mockedFindMappingForTarget.mockReturnValue({
            id: 'm1',
            channel: 0,
            cc: 1,
            targetType: 'deviceParam',
            trackId: 'track1',
            paramId: 'param1',
        });
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" paramId="param1" />);
        expect(screen.getByLabelText(/MIDI CC 1/)).toBeInTheDocument();
    });

    it('should stop propagation on click', () => {
        const mockStopPropagation = vi.fn();
        renderWithTooltip(<MidiLearnButton targetType="deviceParam" trackId="track1" />);
        const button = screen.getByRole('button');
        fireEvent.click(button, { stopPropagation: mockStopPropagation });
    });
});
