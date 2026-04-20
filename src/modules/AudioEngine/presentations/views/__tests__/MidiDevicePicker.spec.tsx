import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MidiDevicePicker } from '../MidiDevicePicker';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        isSupported: true,
        inputs: [
            { id: 'midi1', name: 'MIDI Keyboard', manufacturer: 'Roland' },
            { id: 'midi2', name: 'Drum Pad', manufacturer: 'Akai' },
        ],
        selectedInputId: null,
    })),
}));

const mockInitWebMidi = vi.fn(() => Promise.resolve());
const mockSelectMidiInput = vi.fn();

vi.mock('../../../useCases/webMidiInput/selectMidiInput', () => ({
    selectMidiInput: (id: string) => mockSelectMidiInput(id),
}));

vi.mock('../../../useCases/webMidiInput/initWebMidi', () => ({
    initWebMidi: () => mockInitWebMidi(),
}));

vi.mock('../../../useCases/webMidiInput/helpers', () => ({
    webMidiStore: {},
}));

const { useStore } = await import('#/infra/store/useStore');

describe('MidiDevicePicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [
                { id: 'midi1', name: 'MIDI Keyboard', manufacturer: 'Roland' },
                { id: 'midi2', name: 'Drum Pad', manufacturer: 'Akai' },
            ],
            selectedInputId: null,
        });
    });

    it('should render without crashing', async () => {
        const { container } = render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(container.firstChild).toBeTruthy();
        });
    });

    it('should initialize Web MIDI on mount', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(mockInitWebMidi).toHaveBeenCalled();
        });
    });

    it('should render MIDI Input section', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('MIDI Input')).toBeInTheDocument();
        });
    });

    it('should render MIDI device options', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('MIDI Keyboard (Roland)')).toBeInTheDocument();
            expect(screen.getByText('Drum Pad (Akai)')).toBeInTheDocument();
        });
    });

    it('should call selectMidiInput when selection changes', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            const select = screen.getByLabelText('MIDI input device');
            fireEvent.change(select, { target: { value: 'midi1' } });
            expect(mockSelectMidiInput).toHaveBeenCalledWith('midi1');
        });
    });

    it('should refresh MIDI devices when refresh button is clicked', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            const refreshButton = screen.getByLabelText('Refresh MIDI devices');
            fireEvent.click(refreshButton);
            expect(mockInitWebMidi).toHaveBeenCalledTimes(2);
        });
    });

    it('should show unsupported message when MIDI is not supported', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: false,
            inputs: [],
            selectedInputId: null,
        });
        render(<MidiDevicePicker />);
        expect(screen.getByText('MIDI not supported in this browser')).toBeInTheDocument();
    });

    it('should show connected badge when device is selected', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [{ id: 'midi1', name: 'MIDI Keyboard', manufacturer: 'Roland' }],
            selectedInputId: 'midi1',
        });
        render(<MidiDevicePicker />);
        // The component shows "Connected:" when selectedInputId is set
        expect(screen.getByText(/Connected:/)).toBeInTheDocument();
    });

    it('should have correct aria labels', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByLabelText('MIDI input device')).toBeInTheDocument();
        });
    });

    it('should show "Select a device..." option', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Select a device...')).toBeInTheDocument();
        });
    });
});
