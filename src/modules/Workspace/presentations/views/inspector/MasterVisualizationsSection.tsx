import { type ReactElement } from 'react';
import { LUFSMeter } from '../../components/LUFSMeter';
import { PhaseCorrelationDisplay } from '../../components/PhaseCorrelationDisplay';
import { Oscilloscope } from '../../components/Oscilloscope';
import { SpectrumAnalyzer } from '../../components/SpectrumAnalyzer';
import { Spectrogram } from '../../components/Spectrogram';
import { Goniometer } from '../../components/Goniometer';
import { SpatialPanner } from '../../components/SpatialPanner';
import { Wavetable3D } from '../../components/Wavetable3D';

export const MasterVisualizationsSection = (): ReactElement => {
    return (
        <div>
            <div className="px-1 mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Analysis & Metering
            </div>
            <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <LUFSMeter height={160} width={60} />
                    </div>
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <Goniometer size={140} />
                    </div>
                </div>
                <div className="bg-surface-base border border-border/50 rounded-md p-3 flex items-center justify-center">
                    <Oscilloscope width={280} height={100} />
                </div>
                <div className="bg-surface-base border border-border/50 rounded-md p-3 flex items-center justify-center">
                    <SpectrumAnalyzer width={280} height={100} />
                </div>
                <div className="bg-surface-base border border-border/50 rounded-md p-3 flex items-center justify-center">
                    <Spectrogram width={280} height={100} />
                </div>
                <div className="bg-surface-base border border-border/50 rounded-md p-3 flex items-center justify-center">
                    <PhaseCorrelationDisplay width={280} height={30} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <SpatialPanner size={120} />
                    </div>
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <Wavetable3D width={140} height={100} />
                    </div>
                </div>
            </div>
        </div>
    );
};
