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
        enumerationError: null,
    })),
}));

const mockInitWebMidi = vi.fn(() => Promise.resolve());
const mockSelectMidiInput = vi.fn();

vi.mock('#/modules/MIDI/stores', () => ({
    webMidiStore: {},
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    selectMidiInput: (id: string) => mockSelectMidiInput(id),
    initWebMidi: () => mockInitWebMidi(),
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
            enumerationError: null,
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

    it('shows a retryable hint when enumeration fails but MIDI stays supported', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            enumerationError: 'enumeration failed',
            inputs: [],
            selectedInputId: null,
        });
        mockInitWebMidi.mockResolvedValue(undefined);

        render(<MidiDevicePicker />);

        expect(screen.getByText("Couldn't list MIDI devices. Refresh to try again.")).toBeInTheDocument();
        expect(screen.getByLabelText('Refresh MIDI devices')).toBeInTheDocument();
        expect(screen.queryByText('MIDI not supported in this browser')).not.toBeInTheDocument();

        await waitFor(() => {
            expect(mockInitWebMidi).toHaveBeenCalled();
        });

        mockInitWebMidi.mockClear();
        fireEvent.click(screen.getByLabelText('Refresh MIDI devices'));
        expect(mockInitWebMidi).toHaveBeenCalledTimes(1);
    });

    it('should show connected badge when device is selected', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [{ id: 'midi1', name: 'MIDI Keyboard', manufacturer: 'Roland' }],
            selectedInputId: 'midi1',
            enumerationError: null,
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

    // ── branch coverage: empty-inputs + detection states ─────────────────────

    it('does not call initWebMidi on mount when Web MIDI is unsupported', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: false,
            inputs: [],
            selectedInputId: null,
        });
        render(<MidiDevicePicker />);
        // useEffect returns early before calling initWebMidi.
        await waitFor(() => {
            expect(mockInitWebMidi).not.toHaveBeenCalled();
        });
    });

    it('does not show detecting copy when listing failed before init settles', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            enumerationError: 'enumeration failed',
            inputs: [],
            selectedInputId: null,
        });
        mockInitWebMidi.mockReturnValue(new Promise(() => {}));

        render(<MidiDevicePicker />);

        expect(screen.getByText("Couldn't list MIDI devices. Refresh to try again.")).toBeInTheDocument();
        expect(screen.getByLabelText('Refresh MIDI devices')).toBeInTheDocument();
        expect(screen.queryByText('Detecting devices...')).not.toBeInTheDocument();
        expect(screen.queryByText('Detecting MIDI devices...')).not.toBeInTheDocument();
        expect(screen.getByText('No MIDI devices found')).toBeInTheDocument();
    });

    it('shows the detecting state and a disabled select while devices are empty and not initialised', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [],
            selectedInputId: null,
        });
        // Block initWebMidi from settling so `initialised` stays false.
        mockInitWebMidi.mockReturnValue(new Promise(() => {}));

        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Detecting devices...')).toBeInTheDocument();
        });
        // Detection hint is shown while not initialised and inputs empty.
        expect(screen.getByText('Detecting MIDI devices...')).toBeInTheDocument();
        // The select is disabled when there are no inputs.
        expect(screen.getByLabelText('MIDI input device')).toBeDisabled();
    });

    it('shows "No MIDI devices found" once initialised with an empty device list', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [],
            selectedInputId: null,
        });
        // initWebMidi resolves ⇒ initialised becomes true.
        mockInitWebMidi.mockResolvedValue(undefined);

        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('No MIDI devices found')).toBeInTheDocument();
        });
    });

    it('omits the manufacturer parenthetical when it is "Unknown"', async () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [{ id: 'midiX', name: 'Generic Controller', manufacturer: 'Unknown' }],
            selectedInputId: null,
        });
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Generic Controller')).toBeInTheDocument();
        });
        // No "(Unknown)" suffix.
        expect(screen.queryByText('Generic Controller (Unknown)')).not.toBeInTheDocument();
    });

    it('does not call selectMidiInput when the selection is cleared to an empty value', async () => {
        render(<MidiDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Select a device...')).toBeInTheDocument();
        });
        mockSelectMidiInput.mockClear();
        fireEvent.change(screen.getByLabelText('MIDI input device'), { target: { value: '' } });
        expect(mockSelectMidiInput).not.toHaveBeenCalled();
    });

    it('renders "Connected: Unknown" when the selected device is no longer in the input list', () => {
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            isSupported: true,
            inputs: [{ id: 'midi1', name: 'MIDI Keyboard', manufacturer: 'Roland' }],
            // selectedInputId refers to a device that is absent from inputs.
            selectedInputId: 'disconnected',
            enumerationError: null,
        });
        render(<MidiDevicePicker />);
        // find() returns undefined ⇒ `?? 'Unknown'` fallback ⇒ "Connected: Unknown".
        expect(screen.getByText('Connected: Unknown')).toBeInTheDocument();
    });
});
