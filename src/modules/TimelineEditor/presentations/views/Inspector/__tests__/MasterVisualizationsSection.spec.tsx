import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { MasterVisualizationsSection } from '../MasterVisualizationsSection';

const lifecycle = vi.hoisted(() => ({
    phaseCleanup: vi.fn(),
    goniometerCleanup: vi.fn(),
}));

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

vi.mock('#/modules/Metering/presentations/views', async () => {
    const { useEffect } = await vi.importActual<typeof import('react')>('react');

    return {
        LUFSMeter: () => <div data-testid="lufs-meter">LUFS Meter</div>,
        PhaseCorrelationDisplay: () => {
            useEffect(
                () => () => {
                    lifecycle.phaseCleanup();
                },
                []
            );
            return <div data-testid="phase-correlation">Phase Correlation</div>;
        },
        Oscilloscope: () => <div data-testid="oscilloscope">Oscilloscope</div>,
        SpectrumAnalyzer: () => <div data-testid="spectrum-analyzer">Spectrum Analyzer</div>,
        Spectrogram: () => <div data-testid="spectrogram">Spectrogram</div>,
        Goniometer: () => {
            useEffect(
                () => () => {
                    lifecycle.goniometerCleanup();
                },
                []
            );
            return <div data-testid="goniometer">Goniometer</div>;
        },
        SpatialPanner: () => <div data-testid="spatial-panner">Spatial Panner</div>,
        Wavetable3D: () => <div data-testid="wavetable-3d">Wavetable 3D</div>,
    };
});

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

    it('switches the primary analyzer while the secondary remains Off', () => {
        renderWithTooltip(<MasterVisualizationsSection />);

        fireEvent.change(screen.getByLabelText('Primary analyzer'), { target: { value: 'spectrogram' } });

        expect(screen.getByTestId('spectrogram')).toBeInTheDocument();
        expect(screen.queryByTestId('lufs-meter')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('display-surface')).toHaveLength(1);
        for (const testId of ALL_ANALYZER_TEST_IDS.filter((id) => id !== 'spectrogram')) {
            expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
        }
    });

    it('offers every analyzer as a scope option', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        const select = screen.getByLabelText('Primary analyzer') as HTMLSelectElement;
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

    it('offers a second analyzer slot that starts Off and excludes the primary choice', () => {
        renderWithTooltip(<MasterVisualizationsSection />);

        const secondary = screen.getByLabelText('Secondary analyzer') as HTMLSelectElement;
        expect(secondary.value).toBe('off');
        expect([...secondary.options].map((option) => option.value)).toEqual([
            'off',
            'goniometer',
            'oscilloscope',
            'spectrum',
            'spectrogram',
            'phase',
            'panner',
            'wavetable3d',
        ]);
    });

    it.each([
        ['phase', 'phase-correlation'],
        ['goniometer', 'goniometer'],
    ])('mounts LUFS with the unique secondary analyzer %s', (analyzer, testId) => {
        renderWithTooltip(<MasterVisualizationsSection />);

        fireEvent.change(screen.getByLabelText('Secondary analyzer'), { target: { value: analyzer } });

        expect(screen.getByTestId('lufs-meter')).toBeInTheDocument();
        expect(screen.getByTestId(testId)).toBeInTheDocument();
        expect(screen.getAllByTestId('display-surface')).toHaveLength(2);
        expect(screen.getAllByTestId('lufs-meter')).toHaveLength(1);
        expect(screen.getAllByTestId(testId)).toHaveLength(1);
    });

    it('clears the secondary selection when the primary changes to the same analyzer', () => {
        renderWithTooltip(<MasterVisualizationsSection />);
        fireEvent.change(screen.getByLabelText('Secondary analyzer'), { target: { value: 'phase' } });

        const primary = screen.getByLabelText('Primary analyzer') as HTMLSelectElement;
        expect([...primary.options].map((option) => option.value)).toContain('phase');
        fireEvent.change(primary, { target: { value: 'phase' } });

        expect(screen.getByLabelText('Secondary analyzer')).toHaveValue('off');
        expect(screen.getByTestId('phase-correlation')).toBeInTheDocument();
        expect(screen.queryByTestId('lufs-meter')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('display-surface')).toHaveLength(1);
    });

    it('unmounts secondary analyzers and runs their effect cleanup when switched Off or changed', () => {
        lifecycle.phaseCleanup.mockClear();
        lifecycle.goniometerCleanup.mockClear();
        renderWithTooltip(<MasterVisualizationsSection />);

        fireEvent.change(screen.getByLabelText('Secondary analyzer'), { target: { value: 'phase' } });
        expect(screen.getByTestId('phase-correlation')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Secondary analyzer'), { target: { value: 'goniometer' } });
        expect(screen.queryByTestId('phase-correlation')).not.toBeInTheDocument();
        expect(lifecycle.phaseCleanup).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('goniometer')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Secondary analyzer'), { target: { value: 'off' } });
        expect(screen.queryByTestId('goniometer')).not.toBeInTheDocument();
        expect(lifecycle.goniometerCleanup).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId('display-surface')).toHaveLength(1);
    });

    it('unmounts both analyzer children and cleans up their effects when the section leaves', () => {
        lifecycle.phaseCleanup.mockClear();
        lifecycle.goniometerCleanup.mockClear();
        const { unmount } = renderWithTooltip(<MasterVisualizationsSection />);
        fireEvent.change(screen.getByLabelText('Secondary analyzer'), { target: { value: 'phase' } });
        fireEvent.change(screen.getByLabelText('Primary analyzer'), { target: { value: 'goniometer' } });

        unmount();

        expect(lifecycle.phaseCleanup).toHaveBeenCalledTimes(1);
        expect(lifecycle.goniometerCleanup).toHaveBeenCalledTimes(1);
    });
});
