import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioDevices } from '#/modules/AudioEngine/useCases';

import { setTrackInput } from '../../../../useCases/setTrackInput';
import { InputSelector } from '../InputSelector';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioDevices: vi.fn(),
}));

vi.mock('../../../../useCases/setTrackInput', () => ({
    setTrackInput: vi.fn(),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('InputSelector', () => {
    const mockDevices = [
        { id: 'dev1', kind: 'audioinput', label: 'Microphone' },
        { id: 'dev2', kind: 'audioinput', label: 'Line In' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getAudioDevices).mockResolvedValue(mockDevices);
    });

    it('should render correctly after fetching devices', async () => {
        render(<InputSelector trackId="t1" inputId={null} />);
        await waitFor(() => {
            expect(screen.getByLabelText('Audio input device')).toBeInTheDocument();
        });
    });

    it('should fetch audio devices on mount', async () => {
        render(<InputSelector trackId="t1" inputId={null} />);
        await waitFor(() => {
            expect(getAudioDevices).toHaveBeenCalled();
        });
    });

    it('should show selected input', async () => {
        render(<InputSelector trackId="t1" inputId="dev1" />);
        await waitFor(() => {
            expect(screen.getByText('Microphone')).toBeInTheDocument();
        });
    });

    it('should call setTrackInput when selection changes', async () => {
        render(<InputSelector trackId="t1" inputId={null} />);

        const select = await screen.findByLabelText('Audio input device');
        fireEvent.change(select, { target: { value: 'dev2' } });

        expect(setTrackInput).toHaveBeenCalledWith('t1', 'dev2');
    });

    it('should clear the track input when the Default option is selected', async () => {
        // Selecting the empty-value Default option drives the
        // `event.target.value || null` falsy branch, passing null to
        // setTrackInput so the track returns to its default source.
        render(<InputSelector trackId="t1" inputId="dev1" />);

        const select = await screen.findByLabelText('Audio input device');
        fireEvent.change(select, { target: { value: '' } });

        expect(setTrackInput).toHaveBeenCalledWith('t1', null);
    });

    it('should filter out non-input devices', async () => {
        // Output devices must not appear as selectable inputs.
        vi.mocked(getAudioDevices).mockResolvedValue([
            { id: 'in1', kind: 'audioinput', label: 'Mic' },
            { id: 'out1', kind: 'audiooutput', label: 'Speakers' },
        ]);

        render(<InputSelector trackId="t1" inputId={null} />);

        await screen.findByLabelText('Audio input device');
        // Only the input device is offered; the output device is filtered out.
        expect(screen.getByText('Mic')).toBeInTheDocument();
        expect(screen.queryByText('Speakers')).toBeNull();
    });

    it('should render nothing while devices have not loaded', () => {
        vi.mocked(getAudioDevices).mockReturnValue(new Promise(() => {}));
        const { container } = render(<InputSelector trackId="t1" inputId={null} />);
        // Before the device list resolves the component renders an empty fragment.
        expect(container.querySelector('[aria-label="Audio input device"]')).toBeNull();
    });

    it('should render nothing when no input devices are available', async () => {
        vi.mocked(getAudioDevices).mockResolvedValue([{ id: 'out1', kind: 'audiooutput', label: 'Speakers' }]);
        const { container } = render(<InputSelector trackId="t1" inputId={null} />);
        // After filtering, zero input devices remain → empty fragment.
        await waitFor(() => {
            expect(getAudioDevices).toHaveBeenCalled();
        });
        expect(container.querySelector('[aria-label="Audio input device"]')).toBeNull();
    });
});
