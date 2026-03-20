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
        <section className="flex flex-col gap-2 relative">
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Analysis & Metering
            </h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-3 items-center justify-items-center">
                <LUFSMeter height={100} width={44} />
                <PhaseCorrelationDisplay width={100} height={20} />
                <Oscilloscope width={100} height={60} color="#22c55e" />
                <SpectrumAnalyzer width={100} height={60} color="#3b82f6" />
                <Spectrogram width={100} height={60} />
                <Goniometer size={80} color="#a855f7" />
                <SpatialPanner size={80} />
                <Wavetable3D width={100} height={60} />
            </div>
        </section>
    );
};
