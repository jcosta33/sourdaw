import { type ReactElement } from 'react';

import { DawDisplaySurface } from '#/components/daw/DawDisplaySurface';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';

import { SpatialPanner } from '../../components/SpatialPanner';
import { Wavetable3D } from '../../components/Wavetable3D';
import { Goniometer } from '../Metering/Goniometer';
import { LUFSMeter } from '../Metering/LUFSMeter';
import { Oscilloscope } from '../Metering/Oscilloscope';
import { PhaseCorrelationDisplay } from '../Metering/PhaseCorrelationDisplay';
import { Spectrogram } from '../Metering/Spectrogram';
import { SpectrumAnalyzer } from '../Metering/SpectrumAnalyzer';

export const MasterVisualizationsSection = (): ReactElement => {
    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Analysis & Metering" />
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3">
                    <DawDisplaySurface accentTop>
                        <LUFSMeter height={160} width={60} />
                    </DawDisplaySurface>
                    <DawDisplaySurface accentTop>
                        <Goniometer size={180} />
                    </DawDisplaySurface>
                </div>
                <DawDisplaySurface>
                    <Oscilloscope width={280} height={100} />
                </DawDisplaySurface>
                <DawDisplaySurface>
                    <SpectrumAnalyzer width={280} height={100} />
                </DawDisplaySurface>
                <DawDisplaySurface>
                    <Spectrogram width={280} height={100} />
                </DawDisplaySurface>
                <DawDisplaySurface>
                    <PhaseCorrelationDisplay width={280} height={30} />
                </DawDisplaySurface>
                <div className="flex flex-col gap-3">
                    <DawDisplaySurface accentTop>
                        <SpatialPanner size={160} />
                    </DawDisplaySurface>
                    <DawDisplaySurface accentTop>
                        <Wavetable3D width={200} height={120} />
                    </DawDisplaySurface>
                </div>
            </div>
        </div>
    );
};
