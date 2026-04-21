import { type ReactElement } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Slider } from '#/components/ui/slider';
import { MidiLearnButton } from '#/modules/Arrangement/presentations/views';
import { setTrackGain, setTrackPan } from '#/modules/Arrangement/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type TrackLevelSectionProps = {
    track: Track;
};

export const TrackLevelSection = ({ track }: TrackLevelSectionProps): ReactElement => {
    const renderIife_20 = () => {
        const param = track.pan;
        if (param === 0) {
            return 'C';
        }
        if (param > 0) {
            return `R${param}`;
        }
        return `L${Math.abs(param)}`;
    };

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Level" />
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <SurfaceCard className="w-full p-3">
                    <div className="flex flex-col w-full gap-2">
                        <ControlHeader
                            className="w-full"
                            label="Gain"
                            labelClassName="font-medium text-foreground"
                            value={
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-mono text-muted-foreground">
                                        {(track.gain * 100).toFixed(0)}%
                                    </span>
                                    <MidiLearnButton targetType="trackGain" trackId={track.id} />
                                </div>
                            }
                            valueClassName="font-normal"
                        />
                        <div className="w-full px-1 flex items-center justify-center">
                            <Slider
                                value={[track.gain * 100]}
                                onValueChange={([value]) => {
                                    if (value !== undefined) {
                                        setTrackGain(track.id, value / 100);
                                    }
                                }}
                                max={100}
                                step={1}
                                aria-label={`${track.name} gain`}
                                className="w-full"
                            />
                        </div>
                    </div>
                </SurfaceCard>
                <SurfaceCard className="w-full p-3">
                    <div className="flex flex-row items-center w-full min-w-0 gap-3">
                        <div className="flex flex-col flex-1 min-w-0 overflow-hidden justify-center gap-1.5">
                            <label className="text-[10px] font-medium text-foreground truncate w-full">Pan</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{renderIife_20()}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <MidiLearnButton targetType="trackPan" trackId={track.id} />
                            </div>
                        </div>
                        <div className="shrink-0 flex items-center justify-center">
                            <RotaryKnob
                                value={track.pan}
                                onChange={(value) => {
                                    setTrackPan(track.id, value);
                                }}
                                min={-50}
                                max={50}
                                size="md"
                                aria-label={`${track.name} pan`}
                                bipolar
                            />
                        </div>
                    </div>
                </SurfaceCard>
            </div>
        </div>
    );
};
