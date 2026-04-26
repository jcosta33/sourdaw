import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AudioDevicePicker } from '../AudioDevicePicker';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        selectedOutputId: null,
        selectedInputId: null,
    })),
}));

const mockGetAudioDevices = vi.fn(() =>
    Promise.resolve([
        { id: 'out1', kind: 'audiooutput', label: 'Headphones' },
        { id: 'out2', kind: 'audiooutput', label: 'Speakers' },
        { id: 'in1', kind: 'audioinput', label: 'Microphone' },
        { id: 'in2', kind: 'audioinput', label: 'Line In' },
    ])
);
const mockSetOutputDevice = vi.fn();
const mockSetInputDevice = vi.fn();

vi.mock('../../../useCases/audioDeviceSelection/setInputDevice', () => ({
    setInputDevice: (id: string) => mockSetInputDevice(id),
}));

vi.mock('../../../useCases/audioDeviceSelection/setOutputDevice', () => ({
    setOutputDevice: (id: string) => mockSetOutputDevice(id),
}));

vi.mock('../../../useCases/audioDeviceSelection/getAudioDevices', () => ({
    getAudioDevices: () => mockGetAudioDevices(),
}));

vi.mock('../../../useCases/audioDeviceSelection/helpers', () => ({
    audioDeviceStore: {},
}));

describe('AudioDevicePicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', async () => {
        const { container } = render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(container.firstChild).toBeTruthy();
        });
    });

    it('should fetch devices on mount', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(mockGetAudioDevices).toHaveBeenCalled();
        });
    });

    it('should render Output section', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Output')).toBeInTheDocument();
        });
    });

    it('should render Input section', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Input')).toBeInTheDocument();
        });
    });

    it('should render output devices', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Headphones')).toBeInTheDocument();
            expect(screen.getByText('Speakers')).toBeInTheDocument();
        });
    });

    it('should render input devices', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(screen.getByText('Microphone')).toBeInTheDocument();
            expect(screen.getByText('Line In')).toBeInTheDocument();
        });
    });

    it('should call setOutputDevice when output selection changes', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            const select = screen.getByLabelText('Audio output device');
            fireEvent.change(select, { target: { value: 'out1' } });
            expect(mockSetOutputDevice).toHaveBeenCalledWith('out1');
        });
    });

    it('should call setInputDevice when input selection changes', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            const select = screen.getByLabelText('Audio input device');
            fireEvent.change(select, { target: { value: 'in1' } });
            expect(mockSetInputDevice).toHaveBeenCalledWith('in1');
        });
    });

    it('should refresh devices when refresh button is clicked', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            const refreshButton = screen.getByLabelText('Refresh audio devices');
            fireEvent.click(refreshButton);
            expect(mockGetAudioDevices).toHaveBeenCalledTimes(2); // Once on mount, once on click
        });
    });

    it('should show Default option', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            const selects = screen.getAllByText('Default');
            expect(selects.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('should show loading state', () => {
        const { container } = render(<AudioDevicePicker />);
        expect(
            container.querySelector('[aria-busy="true"]') || screen.queryByText('Detecting devices...')
        ).toBeTruthy();
    });

    it('should have correct aria labels', async () => {
        render(<AudioDevicePicker />);
        await waitFor(() => {
            expect(screen.getByLabelText('Audio output device')).toBeInTheDocument();
            expect(screen.getByLabelText('Audio input device')).toBeInTheDocument();
        });
    });
});
