import { type ReactElement, useState } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Slider } from '#/components/ui/slider';
import { getTrackFaderCeiling, setTrackGain, setTrackPan } from '#/modules/Arrangement/useCases';
import { MidiLearnButton } from '#/modules/ControlSurface/presentations/views';

import { type Track } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type TrackLevelSectionProps = {
    track: Track;
};

export const TrackLevelSection = ({ track }: TrackLevelSectionProps): ReactElement => {
    const [localGain, setLocalGain] = useState<number | null>(null);
    const [localPan, setLocalPan] = useState<number | null>(null);

    const activeGain = localGain !== null ? localGain : track.gain;
    const activePan = localPan !== null ? localPan : track.pan;

    const renderIife_20 = () => {
        const param = activePan;
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
                                        {(activeGain * 100).toFixed(0)}%
                                    </span>
                                    <MidiLearnButton targetType="trackGain" trackId={track.id} />
                                </div>
                            }
                            valueClassName="font-normal"
                        />
                        <div className="w-full px-1 flex items-center justify-center">
                            {/*
                             * Percent of unity, so the readout above and this
                             * control share one scale. The travel is the
                             * writer's own ceiling — `getTrackFaderCeiling`, the
                             * same bound `ExpandedChannelStrip` applies — rather
                             * than a flat 100: a track pushed into the fader's
                             * `+6 dB` of headroom from the mixer reads `150%`
                             * here, and a control that stopped at 100 would
                             * write that make-up gain away on first touch.
                             *
                             * These two handlers deliberately call `setTrackGain`
                             * rather than `executeAppAction`: an Inspector gain
                             * edit has never recorded an undo entry, on any
                             * value, so routing it is a separate repair to the
                             * mutation path and not part of carrying the
                             * ceiling. Widening the travel is what stops this
                             * control destroying a value it cannot represent.
                             */}
                            <Slider
                                value={[activeGain * 100]}
                                onValueChange={([value]) => {
                                    if (value !== undefined) {
                                        setLocalGain(value / 100);
                                        setTrackGain(track.id, value / 100, true);
                                    }
                                }}
                                onValueCommit={([value]) => {
                                    if (value !== undefined) {
                                        setLocalGain(null);
                                        setTrackGain(track.id, value / 100, false);
                                    }
                                }}
                                max={getTrackFaderCeiling(track.id) * 100}
                                step={1}
                                aria-label={`${track.name} gain`}
                                data-testid="inspector-track-gain"
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
                        <div className="shrink-0 flex items-center justify-center" data-testid="inspector-track-pan">
                            <RotaryKnob
                                value={activePan}
                                onChange={(value, isTransient) => {
                                    if (isTransient) {
                                        setLocalPan(value);
                                        setTrackPan(track.id, value, true);
                                    } else {
                                        setLocalPan(null);
                                        setTrackPan(track.id, value, false);
                                    }
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
