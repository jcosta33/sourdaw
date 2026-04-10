import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { getAudioDevices } from '../../../useCases/trackViewActions';
import { setTrackInput } from '#/modules/Arrangement/useCases/setTrackInput';
import { InputSelector } from './InputSelector';

// Mock external dependencies
vi.mock('../../../useCases/trackViewActions', () => ({
    getAudioDevices: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackInput', () => ({
    setTrackInput: vi.fn(),
}));

describe('InputSelector', () => {
    const mockDevices = [
        { id: 'dev1', kind: 'audioinput', label: 'Microphone' },
        { id: 'dev2', kind: 'audioinput', label: 'Line In' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getAudioDevices).mockResolvedValue(mockDevices as any);
    });

    it('should render correctly after fetching devices', async () => {
        let container: HTMLElement;
        await act(async () => {
            const result = render(<InputSelector trackId="t1" inputId={null} />);
            container = result.container;
        });
        
        await waitFor(() => {
            expect(screen.getByLabelText('Audio input device')).toBeInTheDocument();
        });
    });

    it('should fetch audio devices on mount', async () => {
        await act(async () => {
            render(<InputSelector trackId="t1" inputId={null} />);
        });
        expect(getAudioDevices).toHaveBeenCalled();
    });

    it('should show selected input', async () => {
        await act(async () => {
            render(<InputSelector trackId="t1" inputId="dev1" />);
        });
        await waitFor(() => {
            expect(screen.getByText('Microphone')).toBeInTheDocument();
        });
    });

    it('should call setTrackInput when selection changes', async () => {
        await act(async () => {
            render(<InputSelector trackId="t1" inputId={null} />);
        });
        
        const select = await screen.findByLabelText('Audio input device');
        fireEvent.change(select, { target: { value: 'dev2' } });

        expect(setTrackInput).toHaveBeenCalledWith('t1', 'dev2');
    });
});
