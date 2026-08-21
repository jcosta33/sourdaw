import { type ReactElement, type ReactNode, useRef, useState, useEffect } from 'react';

import { DawAnalysisCard } from '#/components/daw/DawAnalysisCard';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Row } from '#/components/layout';
import { ScrollArea } from '#/components/ui/scroll-area';

import { Goniometer } from './Goniometer';
import { LUFSMeter } from './LUFSMeter';
import { Oscilloscope } from './Oscilloscope';
import { PhaseCorrelationDisplay } from './PhaseCorrelationDisplay';
import { SpatialPanner } from './SpatialPanner';
import { Spectrogram } from './Spectrogram';
import { SpectrumAnalyzer } from './SpectrumAnalyzer';
import { Wavetable3D } from './Wavetable3D';

/* ── Measured container ─────────────────────────────── */
type MeasuredProps = {
    children: (size: { width: number; height: number }) => ReactNode;
    className?: string;
};

/** Measures its own pixel dimensions and passes them to a render-prop child.
 *  Uses absolute positioning so the canvas child cannot influence container size. */
const Measured = ({ children, className = '' }: MeasuredProps): ReactElement => {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) {
            return undefined;
        }
        const ro = new ResizeObserver(([entry]) => {
            if (entry) {
                const { width, height } = entry.contentRect;
                const w = Math.floor(width);
                const h = Math.floor(height);
                setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={ref} className={`relative ${className}`}>
            <Row justify="center" className="absolute inset-0 overflow-hidden">
                {size.width > 0 && size.height > 0 ? children(size) : null}
            </Row>
        </div>
    );
};

/* ── Panel ───────────────────────────────────────────── */
export const AnalysisPanel = (): ReactElement => {
    return (
        <DawPanelSurface>
            <ScrollArea className="flex-1">
                <Row align="stretch" wrap gap={2} className="p-2">
                    <DawAnalysisCard
                        title="Spectrum Analyzer"
                        detail="FFT spectrum in a shared analyzer shell."
                        className="min-w-[280px] max-w-[600px] flex-1 h-[140px]"
                    >
                        <Measured className="w-full h-full">
                            {({ width, height }) => <SpectrumAnalyzer width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard
                        title="Oscilloscope"
                        detail="Waveform trace with the same inset meter frame."
                        className="min-w-[280px] max-w-[600px] flex-1 h-[140px]"
                    >
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Oscilloscope width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard
                        title="Spectrogram"
                        detail="Time-based energy map in the shared analysis shell."
                        className="min-w-[280px] max-w-[600px] flex-1 h-[140px]"
                    >
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Spectrogram width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Wavetable 3D" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Wavetable3D width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard
                        title="Goniometer"
                        detail="Stereo image scatter plot."
                        className="w-[140px] shrink-0 h-[140px]"
                    >
                        <Measured className="w-full h-full">
                            {({ width, height }) => {
                                const state = Math.min(width, height);
                                return <Goniometer size={state} />;
                            }}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Spatial Panner" className="w-[140px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => {
                                const state = Math.min(width, height);
                                return <SpatialPanner size={state} />;
                            }}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard
                        title="LUFS"
                        detail="Momentary, short-term, and integrated loudness."
                        className="w-[80px] shrink-0 h-[140px]"
                    >
                        <Measured className="w-full h-full">
                            {({ width, height }) => <LUFSMeter width={Math.min(width, 60)} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard
                        title="Phase Correlation"
                        detail="Mono compatibility from -1 to +1."
                        className="w-full h-[48px]"
                    >
                        <Measured className="w-full h-full">
                            {({ width }) => <PhaseCorrelationDisplay width={width} height={20} />}
                        </Measured>
                    </DawAnalysisCard>
                </Row>
            </ScrollArea>
        </DawPanelSurface>
    );
};
