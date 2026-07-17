import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../../hooks/useTracks';
import { MiniMasterSpectrum } from '../MiniMasterSpectrum';

// Mock external dependencies
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getMasterAnalyser: vi.fn(() => ({
        frequencyBinCount: 128,
        fftSize: 256,
        getByteFrequencyData: vi.fn(),
    })),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [{ id: 'master', kind: 'master' }],
        selectedTrackId: 'master',
    })),
}));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('MiniMasterSpectrum', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock to default state
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [{ id: 'master', kind: 'master' }],
            selectedTrackId: 'master',
        });
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render null when no master track', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [{ id: 'audio1', kind: 'audio' }],
            selectedTrackId: null,
        });
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toBeNull();
    });

    it('should render canvas element', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should display "Master" label', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toBeInTheDocument();
    });

    it('should call selectTrack when clicked', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.click(spectrum);
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should call selectTrack when Enter key is pressed', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.keyDown(spectrum, { key: 'Enter' });
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should have pointer cursor', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toHaveClass('cursor-pointer');
    });

    it('should apply custom className', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should have correct title attribute', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toHaveAttribute(
            'title',
            'Master Track (Click to inspect)'
        );
    });
});
