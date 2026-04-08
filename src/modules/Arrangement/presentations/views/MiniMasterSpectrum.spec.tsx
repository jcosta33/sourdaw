import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiniMasterSpectrum } from './MiniMasterSpectrum';

// Mock external dependencies
vi.mock('#/modules/AudioEngine/useCases/engineAccess', () => ({
    getMasterAnalyser: vi.fn(() => ({
        frequencyBinCount: 128,
        fftSize: 256,
        getByteFrequencyData: vi.fn(),
    })),
}));

vi.mock('../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [{ id: 'master', kind: 'master' }],
        selectedTrackId: 'master',
    })),
}));

vi.mock('../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn(),
}));

describe('MiniMasterSpectrum', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<MiniMasterSpectrum />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render null when no master track', () => {
        const { useTracks } = vi.importMock('../hooks/useTracks');
        useTracks.mockReturnValue({
            tracks: [{ id: 'audio1', kind: 'audio' }],
            selectedTrackId: null,
        });
        const { container } = render(<MiniMasterSpectrum />);
        expect(container.firstChild).toBeNull();
    });

    it('should render canvas element', () => {
        const { container } = render(<MiniMasterSpectrum />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should display "Master" label', () => {
        render(<MiniMasterSpectrum />);
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        render(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toBeInTheDocument();
    });

    it('should call selectTrack when clicked', () => {
        const { selectTrack } = vi.importMock('../../useCases/toggleTrackState/selectTrack');
        render(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.click(spectrum);
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should call selectTrack when Enter key is pressed', () => {
        const { selectTrack } = vi.importMock('../../useCases/toggleTrackState/selectTrack');
        render(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.keyDown(spectrum, { key: 'Enter' });
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should have pointer cursor', () => {
        const { container } = render(<MiniMasterSpectrum />);
        expect(container.firstChild).toHaveClass('cursor-pointer');
    });

    it('should apply custom className', () => {
        const { container } = render(<MiniMasterSpectrum className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should have correct title attribute', () => {
        render(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toHaveAttribute('title', 'Master Track (Click to inspect)');
    });
});
