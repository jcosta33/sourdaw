import { type ReactElement } from 'react';
import { LUFSMeter } from '../metering/LUFSMeter';
import { PhaseCorrelationDisplay } from '../metering/PhaseCorrelationDisplay';
import { Oscilloscope } from '../metering/Oscilloscope';
import { SpectrumAnalyzer } from '../metering/SpectrumAnalyzer';
import { Spectrogram } from '../metering/Spectrogram';
import { Goniometer } from '../metering/Goniometer';
import { SpatialPanner } from '../../components/SpatialPanner';
import { Wavetable3D } from '../../components/Wavetable3D';

export const MasterVisualizationsSection = (): ReactElement => {
    return (
        <div>
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Analysis & Metering
            </div>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3">
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <LUFSMeter height={160} width={60} />
                    </div>
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <Goniometer size={180} />
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
                <div className="flex flex-col gap-3">
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <SpatialPanner size={160} />
                    </div>
                    <div className="bg-surface-base border border-border/50 border-t-[var(--color-light-edge)] rounded-md p-3 flex items-center justify-center">
                        <Wavetable3D width={200} height={120} />
                    </div>
                </div>
            </div>
        </div>
    );
};
