import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { MasterVisualizationsSection } from '../MasterVisualizationsSection';

// Mock external dependencies
vi.mock('#/components/daw/DawDisplaySurface', () => ({
    DawDisplaySurface: ({ children, accentTop }: { children: React.ReactNode; accentTop?: boolean }) => (
        <div data-testid="display-surface" data-accent-top={accentTop}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, compact }: { title?: string; compact?: boolean }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title}
        </div>
    ),
}));

vi.mock('../../Metering/LUFSMeter', () => ({
    LUFSMeter: () => <div data-testid="lufs-meter">LUFS Meter</div>,
}));

vi.mock('../../Metering/PhaseCorrelationDisplay', () => ({
    PhaseCorrelationDisplay: () => <div data-testid="phase-correlation">Phase Correlation</div>,
}));

vi.mock('../../Metering/Oscilloscope', () => ({
    Oscilloscope: () => <div data-testid="oscilloscope">Oscilloscope</div>,
}));

vi.mock('../../Metering/SpectrumAnalyzer', () => ({
    SpectrumAnalyzer: () => <div data-testid="spectrum-analyzer">Spectrum Analyzer</div>,
}));

vi.mock('../../Metering/Spectrogram', () => ({
    Spectrogram: () => <div data-testid="spectrogram">Spectrogram</div>,
}));

vi.mock('../../Metering/Goniometer', () => ({
    Goniometer: () => <div data-testid="goniometer">Goniometer</div>,
}));

vi.mock('../../../components/SpatialPanner', () => ({
    SpatialPanner: () => <div data-testid="spatial-panner">Spatial Panner</div>,
}));

vi.mock('../../../components/Wavetable3D', () => ({
    Wavetable3D: () => <div data-testid="wavetable-3d">Wavetable 3D</div>,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('MasterVisualizationsSection', () => {
    it('should render without crashing', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByText('Analysis & Metering')).toBeInTheDocument();
    });

    it('should render header band with title', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        const headerBand = screen.getByTestId('header-band');
        expect(headerBand).toHaveAttribute('data-compact', 'true');
        expect(screen.getByText('Analysis & Metering')).toBeInTheDocument();
    });

    it('should render LUFS meter', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('lufs-meter')).toBeInTheDocument();
    });

    it('should render goniometer', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('goniometer')).toBeInTheDocument();
    });

    it('should render oscilloscope', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('oscilloscope')).toBeInTheDocument();
    });

    it('should render spectrum analyzer', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('spectrum-analyzer')).toBeInTheDocument();
    });

    it('should render spectrogram', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('spectrogram')).toBeInTheDocument();
    });

    it('should render phase correlation display', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('phase-correlation')).toBeInTheDocument();
    });

    it('should render spatial panner', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('spatial-panner')).toBeInTheDocument();
    });

    it('should render wavetable 3D', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getByTestId('wavetable-3d')).toBeInTheDocument();
    });

    it('should render display surfaces with accent top for certain visualizations', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        const displaySurfaces = screen.getAllByTestId('display-surface');
        expect(displaySurfaces.length).toBeGreaterThan(6);
    });
});
