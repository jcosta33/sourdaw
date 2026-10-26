import { type ReactElement, type ChangeEvent, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawDisplaySurface } from '#/components/daw/DawDisplaySurface';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import {
    Goniometer,
    LUFSMeter,
    Oscilloscope,
    PhaseCorrelationDisplay,
    SpatialPanner,
    Spectrogram,
    SpectrumAnalyzer,
    Wavetable3D,
} from '#/modules/Metering/presentations/views';

type AnalyzerId =
    'lufs' | 'goniometer' | 'oscilloscope' | 'spectrum' | 'spectrogram' | 'phase' | 'panner' | 'wavetable3d';

const ANALYZER_OPTIONS: ReadonlyArray<{ id: AnalyzerId; label: string }> = [
    { id: 'lufs', label: 'LUFS' },
    { id: 'goniometer', label: 'Goniometer' },
    { id: 'oscilloscope', label: 'Oscilloscope' },
    { id: 'spectrum', label: 'Spectrum' },
    { id: 'spectrogram', label: 'Spectrogram' },
    { id: 'phase', label: 'Phase Correlation' },
    { id: 'panner', label: 'Spatial Panner' },
    { id: 'wavetable3d', label: 'Wavetable 3D' },
];

const ANALYZER_RENDERERS: Record<AnalyzerId, () => ReactElement> = {
    lufs: () => <LUFSMeter height={160} width={60} />,
    goniometer: () => <Goniometer size={150} />,
    oscilloscope: () => <Oscilloscope width={150} height={100} />,
    spectrum: () => <SpectrumAnalyzer width={150} height={100} />,
    spectrogram: () => <Spectrogram width={150} height={100} />,
    phase: () => <PhaseCorrelationDisplay width={150} height={30} />,
    panner: () => <SpatialPanner size={150} />,
    wavetable3d: () => <Wavetable3D width={150} height={120} />,
};

/**
 * Six of these eight views (all but SpatialPanner and Wavetable3D, which redraw
 * only on state/interaction changes) run their own `requestAnimationFrame` loop
 * over a live canvas (audit m18); mounting all eight together — as this section
 * used to — means six continuous redraws for however long the master track's
 * Inspector stays open, regardless of which one anyone is looking at.
 * This section mounts only the selected analyzers, so switching away from a
 * scope actually unmounts it and stops its RAF loop instead of hiding it behind
 * CSS. Two slots cover the common loudness-plus-phase mastering workflow while
 * keeping the number of active loops bounded.
 */
export const MasterVisualizationsSection = (): ReactElement => {
    const [primary, setPrimary] = useState<AnalyzerId>('lufs');
    const [secondary, setSecondary] = useState<AnalyzerId | 'off'>('off');

    const handlePrimarySelect = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextPrimary = event.target.value as AnalyzerId;
        setPrimary(nextPrimary);
        if (nextPrimary === secondary) {
            setSecondary('off');
        }
    };

    const selectedAnalyzers = secondary === 'off' ? [primary] : [primary, secondary];

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Analysis & Metering" />
            <div className="mb-2 grid min-w-0 grid-cols-2 gap-1">
                <label className="flex min-w-0 flex-col gap-0.5 text-[9px] text-muted-foreground">
                    <span>Primary</span>
                    <DawCompactSelect
                        size="micro"
                        className="w-full min-w-0"
                        value={primary}
                        onChange={handlePrimarySelect}
                        aria-label="Primary analyzer"
                    >
                        {ANALYZER_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </DawCompactSelect>
                </label>
                <label className="flex min-w-0 flex-col gap-0.5 text-[9px] text-muted-foreground">
                    <span>Secondary</span>
                    <DawCompactSelect
                        size="micro"
                        className="w-full min-w-0"
                        value={secondary}
                        onChange={(event) => setSecondary(event.target.value as AnalyzerId | 'off')}
                        aria-label="Secondary analyzer"
                    >
                        <option value="off">Off</option>
                        {ANALYZER_OPTIONS.filter((option) => option.id !== primary).map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </DawCompactSelect>
                </label>
            </div>
            <div className="grid min-w-0 gap-1">
                {selectedAnalyzers.map((analyzer) => (
                    <DawDisplaySurface key={analyzer} accentTop className="min-w-0 max-w-full overflow-hidden">
                        {ANALYZER_RENDERERS[analyzer]()}
                    </DawDisplaySurface>
                ))}
            </div>
        </div>
    );
};
