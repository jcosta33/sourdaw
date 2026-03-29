import { type ReactElement, type ReactNode, useRef, useState, useEffect } from 'react';
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

/* ── Card wrapper ────────────────────────────────────── */
type AnalysisCardProps = {
    title: string;
    children: ReactNode;
    className?: string;
};

const AnalysisCard = ({ title, children, className = '' }: AnalysisCardProps): ReactElement => (
    <div
        className={`bg-surface-well border border-border-soft rounded-lg overflow-hidden flex flex-col min-w-0 min-h-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] ${className}`}
    >
        <div className="px-2.5 py-1 border-b border-border-hairline bg-surface-base/50 shrink-0">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
        </div>
        <div className="flex-1 flex items-center justify-center min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
);

/* ── Panel ───────────────────────────────────────────── */
export const AnalysisPanel = (): ReactElement => {
    return (
        <div className="flex flex-col h-full bg-surface-base">
            <ScrollArea className="flex-1">
                <div className="p-2 flex flex-wrap gap-2">
                    {/* Wide cards: min 280, max 600, h-[140px] */}
                    <AnalysisCard title="Spectrum Analyzer" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <SpectrumAnalyzer width={width} height={height} />}
                        </Measured>
                    </AnalysisCard>

                    <AnalysisCard title="Oscilloscope" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Oscilloscope width={width} height={height} />}
                        </Measured>
                    </AnalysisCard>

                    <AnalysisCard title="Spectrogram" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Spectrogram width={width} height={height} />}
                        </Measured>
                    </AnalysisCard>

                    <AnalysisCard title="Wavetable 3D" className="min-w-[280px] max-w-[600px] flex-1 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <Wavetable3D width={width} height={height} />}
                        </Measured>
                    </AnalysisCard>

                    {/* Square cards: fixed width, same row */}
                    <AnalysisCard title="Goniometer" className="w-[140px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => {
                                const s = Math.min(width, height);
                                return <Goniometer size={s} />;
                            }}
                        </Measured>
                    </AnalysisCard>

                    <AnalysisCard title="Spatial Panner" className="w-[140px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => {
                                const s = Math.min(width, height);
                                return <SpatialPanner size={s} />;
                            }}
                        </Measured>
                    </AnalysisCard>

                    {/* Tall narrow: LUFS */}
                    <AnalysisCard title="LUFS" className="w-[80px] shrink-0 h-[140px]">
                        <Measured className="w-full h-full">
                            {({ width, height }) => <LUFSMeter width={Math.min(width, 60)} height={height} />}
                        </Measured>
                    </AnalysisCard>

                    {/* Full-width bar: Phase Correlation */}
                    <AnalysisCard title="Phase Correlation" className="w-full h-[48px]">
                        <Measured className="w-full h-full">
                            {({ width }) => <PhaseCorrelationDisplay width={width} height={20} />}
                        </Measured>
                    </AnalysisCard>
                </div>
            </ScrollArea>
        </div>
    );
};
