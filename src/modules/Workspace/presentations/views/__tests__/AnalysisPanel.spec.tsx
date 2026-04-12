import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisPanel } from '../AnalysisPanel';

// Mock UI components
vi.mock('#/components/daw/DawPanelSurface', () => ({
    DawPanelSurface: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="daw-panel-surface">{children}</div>
    ),
}));

vi.mock('#/components/daw/DawAnalysisCard', () => ({
    DawAnalysisCard: ({ 
        title, 
        children, 
        className 
    }: { 
        title: string; 
        children: React.ReactNode;
        className?: string;
    }) => (
        <div data-testid={`analysis-card-${title.toLowerCase().replace(/\s+/g, '-')}`} className={className}>
            <h3>{title}</h3>
            {children}
        </div>
    ),
}));

vi.mock('#/components/ui/scroll-area', () => ({
    ScrollArea: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="scroll-area">{children}</div>
    ),
}));

// Mock metering components
vi.mock('../Metering/LUFSMeter', () => ({
    LUFSMeter: ({ width, height }: { width: number; height: number }) => (
        <div data-testid="lufs-meter" style={{ width, height }}>LUFS Meter</div>
    ),
}));

vi.mock('../Metering/PhaseCorrelationDisplay', () => ({
    PhaseCorrelationDisplay: ({ width, height }: { width: number; height: number }) => (
        <div data-testid="phase-correlation" style={{ width, height }}>Phase Correlation</div>
    ),
}));

vi.mock('../Metering/Oscilloscope', () => ({
    Oscilloscope: ({ width, height }: { width: number; height: number }) => (
        <div data-testid="oscilloscope" style={{ width, height }}>Oscilloscope</div>
    ),
}));

vi.mock('../Metering/SpectrumAnalyzer', () => ({
    SpectrumAnalyzer: ({ width, height }: { width: number; height: number }) => (
        <div data-testid="spectrum-analyzer" style={{ width, height }}>Spectrum Analyzer</div>
    ),
}));

vi.mock('../Metering/Spectrogram', () => ({
    Spectrogram: ({ width, height }: { width: number; height: number }) => (
        <div data-testid="spectrogram" style={{ width, height }}>Spectrogram</div>
    ),
}));

vi.mock('../Metering/Goniometer', () => ({
    Goniometer: ({ size }: { size: number }) => (
        <div data-testid="goniometer" style={{ width: size, height: size }}>Goniometer</div>
    ),
}));

vi.mock('../../components/SpatialPanner', () => ({
    SpatialPanner: ({ size }: { size: number }) => (
        <div data-testid="spatial-panner" style={{ width: size, height: size }}>Spatial Panner</div>
    ),
}));

vi.mock('../../components/Wavetable3D', () => ({
    Wavetable3D: ({ width, height }: { width: number; height: number }) => (
        <div data-testid="wavetable-3d" style={{ width, height }}>Wavetable 3D</div>
    ),
}));

describe('AnalysisPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('daw-panel-surface')).toBeInTheDocument();
    });

    it('should render scroll area', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('scroll-area')).toBeInTheDocument();
    });

    it('should render Spectrum Analyzer card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-spectrum-analyzer')).toBeInTheDocument();
        expect(screen.getByText('Spectrum Analyzer')).toBeInTheDocument();
    });

    it('should render Oscilloscope card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-oscilloscope')).toBeInTheDocument();
        expect(screen.getByText('Oscilloscope')).toBeInTheDocument();
    });

    it('should render Spectrogram card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-spectrogram')).toBeInTheDocument();
        expect(screen.getByText('Spectrogram')).toBeInTheDocument();
    });

    it('should render Wavetable 3D card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-wavetable-3d')).toBeInTheDocument();
        expect(screen.getByText('Wavetable 3D')).toBeInTheDocument();
    });

    it('should render Goniometer card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-goniometer')).toBeInTheDocument();
        expect(screen.getByText('Goniometer')).toBeInTheDocument();
    });

    it('should render Spatial Panner card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-spatial-panner')).toBeInTheDocument();
        expect(screen.getByText('Spatial Panner')).toBeInTheDocument();
    });

    it('should render LUFS card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-lufs')).toBeInTheDocument();
        expect(screen.getByText('LUFS')).toBeInTheDocument();
    });

    it('should render Phase Correlation card', () => {
        render(<AnalysisPanel />);
        expect(screen.getByTestId('analysis-card-phase-correlation')).toBeInTheDocument();
        expect(screen.getByText('Phase Correlation')).toBeInTheDocument();
    });
});
