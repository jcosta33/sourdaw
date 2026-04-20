import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAudioDevices } from '#/modules/AudioEngine/useCases';

import { setTrackInput } from '../../../../useCases/setTrackInput';
import { InputSelector } from '../InputSelector';

vi.mock('#/modules/AudioEngine/useCases/audioDeviceSelection/getAudioDevices', () => ({
    getAudioDevices: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async () => {
    const { getAudioDevices } = await import('#/modules/AudioEngine/useCases/audioDeviceSelection/getAudioDevices');
    return {
        getAudioDevices,
    };
});

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
        vi.mocked(getAudioDevices).mockResolvedValue(mockDevices as never);
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
});
