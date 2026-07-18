import { type ReactElement } from 'react';

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
