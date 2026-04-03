import { type ReactElement, type ReactNode, useRef, useState, useEffect } from 'react';
import { DawAnalysisCard } from '#/components/daw/DawAnalysisCard';
import { ScrollArea } from '#/components/ui/scroll-area';
import { LUFSMeter } from './Metering/LUFSMeter';
import { PhaseCorrelationDisplay } from './Metering/PhaseCorrelationDisplay';
import { Oscilloscope } from './Metering/Oscilloscope';
import { SpectrumAnalyzer } from './Metering/SpectrumAnalyzer';
import { Spectrogram } from './Metering/Spectrogram';
import { Goniometer } from './Metering/Goniometer';
import { SpatialPanner } from '../components/SpatialPanner';
import { Wavetable3D } from '../components/Wavetable3D';

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
            return;
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
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                {size.width > 0 && size.height > 0 ? children(size) : null}
            </div>
        </div>
    );
};

/* ── Panel ───────────────────────────────────────────── */
export const AnalysisPanel = (): ReactElement => {
    return (
        <div className="flex flex-col h-full bg-surface-base">
            <ScrollArea className="flex-1">
                <div className="p-2 flex flex-wrap gap-2">
                    <DawAnalysisCard title="Spectrum Analyzer" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <SpectrumAnalyzer width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Oscilloscope" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Oscilloscope width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Spectrogram" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Spectrogram width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Wavetable 3D" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Wavetable3D width={width} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Goniometer" className="w-[140px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => {
                                const s = Math.min(width, height);
                                return <Goniometer size={s} />;
                            }}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Spatial Panner" className="w-[140px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => {
                                const s = Math.min(width, height);
                                return <SpatialPanner size={s} />;
                            }}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="LUFS" className="w-[80px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <LUFSMeter width={Math.min(width, 60)} height={height} />}
                        </Measured>
                    </DawAnalysisCard>

                    <DawAnalysisCard title="Phase Correlation" className="w-full h-[48px]">
                        <Measured className="w-full h-full">
                            {({ width }) => <PhaseCorrelationDisplay width={width} height={20} />}
                        </Measured>
                    </DawAnalysisCard>
                </div>
            </ScrollArea>
        </div>
    );
};
