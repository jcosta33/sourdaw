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
    goniometer: () => <Goniometer size={180} />,
    oscilloscope: () => <Oscilloscope width={280} height={100} />,
    spectrum: () => <SpectrumAnalyzer width={280} height={100} />,
    spectrogram: () => <Spectrogram width={280} height={100} />,
    phase: () => <PhaseCorrelationDisplay width={280} height={30} />,
    panner: () => <SpatialPanner size={160} />,
    wavetable3d: () => <Wavetable3D width={200} height={120} />,
};

/**
 * Six of these eight views (all but SpatialPanner and Wavetable3D, which redraw
 * only on state/interaction changes) run their own `requestAnimationFrame` loop
 * over a live canvas (audit m18); mounting all eight together — as this section
 * used to — means six continuous redraws for however long the master track's
 * Inspector stays open, regardless of which one anyone is looking at.
 * Standard DAW inspectors show one scope at a time (a scope select, not a
 * wall of meters); this section mounts only the selected analyzer, so
 * switching away from one actually unmounts it and stops its RAF loop
 * instead of just hiding it behind CSS.
 */
export const MasterVisualizationsSection = (): ReactElement => {
    const [selected, setSelected] = useState<AnalyzerId>('lufs');

    const handleSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
        setSelected(event.target.value as AnalyzerId);
    };

    return (
        <div>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Analysis & Metering"
                actions={
                    <DawCompactSelect size="micro" value={selected} onChange={handleSelect} aria-label="Analyzer">
                        {ANALYZER_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </DawCompactSelect>
                }
            />
            <DawDisplaySurface accentTop>{ANALYZER_RENDERERS[selected]()}</DawDisplaySurface>
        </div>
    );
};
