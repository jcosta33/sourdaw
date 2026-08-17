import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
    DawHeaderBand: ({ title, compact, actions }: { title?: string; compact?: boolean; actions?: React.ReactNode }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title}
            {actions}
        </div>
    ),
}));

vi.mock('#/modules/Metering/presentations/views', () => ({
    LUFSMeter: () => <div data-testid="lufs-meter">LUFS Meter</div>,
    PhaseCorrelationDisplay: () => <div data-testid="phase-correlation">Phase Correlation</div>,
    Oscilloscope: () => <div data-testid="oscilloscope">Oscilloscope</div>,
    SpectrumAnalyzer: () => <div data-testid="spectrum-analyzer">Spectrum Analyzer</div>,
    Spectrogram: () => <div data-testid="spectrogram">Spectrogram</div>,
    Goniometer: () => <div data-testid="goniometer">Goniometer</div>,
    SpatialPanner: () => <div data-testid="spatial-panner">Spatial Panner</div>,
    Wavetable3D: () => <div data-testid="wavetable-3d">Wavetable 3D</div>,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

const ALL_ANALYZER_TEST_IDS = [
    'lufs-meter',
    'goniometer',
    'oscilloscope',
    'spectrum-analyzer',
    'spectrogram',
    'phase-correlation',
    'spatial-panner',
    'wavetable-3d',
];

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

    it('mounts only the LUFS meter by default', () => {
        // Audit m18: mounting all eight analyzers together means seven
        // continuous requestAnimationFrame loops running for the entire time
        // the master track's Inspector is open, whether or not anyone is
        // looking at seven of them. Only the default selection should mount.
        renderWithTooltip(<MasterVisualizationsSection />);

        expect(screen.getByTestId('lufs-meter')).toBeInTheDocument();
        for (const testId of ALL_ANALYZER_TEST_IDS.filter((id) => id !== 'lufs-meter')) {
            expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
        }
    });

    it('mounts exactly one display surface at a time', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        expect(screen.getAllByTestId('display-surface')).toHaveLength(1);
    });

    it('switches the mounted analyzer, unmounting the previous one, via the scope select', () => {
        renderWithTooltip(<MasterVisualizationsSection />);

        fireEvent.change(screen.getByLabelText('Analyzer'), { target: { value: 'spectrogram' } });

        expect(screen.getByTestId('spectrogram')).toBeInTheDocument();
        expect(screen.queryByTestId('lufs-meter')).not.toBeInTheDocument();
        for (const testId of ALL_ANALYZER_TEST_IDS.filter((id) => id !== 'spectrogram')) {
            expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
        }
    });

    it('offers every analyzer as a scope option', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        const select = screen.getByLabelText('Analyzer') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual([
            'lufs',
            'goniometer',
            'oscilloscope',
            'spectrum',
            'spectrogram',
            'phase',
            'panner',
            'wavetable3d',
        ]);
    });
});
