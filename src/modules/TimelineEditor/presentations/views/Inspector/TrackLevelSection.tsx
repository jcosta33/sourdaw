import { type ReactElement, useState } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
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
                    <Stack gap={2} className="w-full">
                        <ControlHeader
                            className="w-full"
                            label="Gain"
                            labelClassName="font-medium text-foreground"
                            value={
                                <Row gap={1.5}>
                                    <span className="text-[10px] font-mono text-muted-foreground">
                                        {(activeGain * 100).toFixed(0)}%
                                    </span>
                                    <MidiLearnButton targetType="trackGain" trackId={track.id} />
                                </Row>
                            }
                            valueClassName="font-normal"
                        />
                        <Row justify="center" className="w-full px-1">
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
                        </Row>
                    </Stack>
                </SurfaceCard>
                <SurfaceCard className="w-full p-3">
                    <Row gap={3} className="w-full">
                        <Stack justify="center" grow gap={1.5} className="min-w-0 overflow-hidden">
                            <label className="text-[10px] font-medium text-foreground truncate w-full">Pan</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{renderIife_20()}</span>
                            <Row gap={1.5} className="mt-0.5">
                                <MidiLearnButton targetType="trackPan" trackId={track.id} />
                            </Row>
                        </Stack>
                        <Row justify="center" shrink={false} data-testid="inspector-track-pan">
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
                        </Row>
                    </Row>
                </SurfaceCard>
            </div>
        </div>
    );
};
