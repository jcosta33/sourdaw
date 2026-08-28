import { type ReactElement, useState } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { setTrackGain, setTrackPan } from '#/modules/Arrangement/useCases';
import { releaseTouchAutomation } from '#/modules/Automation/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { MidiLearnButton } from '#/modules/ControlSurface/presentations/views';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type Track } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type TrackLevelSectionProps = {
    track: Track;
};

type LevelParameter = 'gain' | 'pan';

const formatPan = (param: number): string => {
    if (param === 0) {
        return 'C';
    }
    if (param > 0) {
        return `R${param}`;
    }
    return `L${Math.abs(param)}`;
};

const restoreEngineFromProjectTruth = (track: Track, parameterId: LevelParameter): void => {
    const committed = trackStore.value?.tracks.find((candidate) => candidate.id === track.id);
    if (parameterId === 'gain') {
        setTrackGain(track.id, committed?.gain ?? track.gain, true);
        return;
    }
    setTrackPan(track.id, committed?.pan ?? track.pan, true);
};

const releaseTouch = (track: Track, parameterId: LevelParameter): void => {
    if (track.automationMode === 'touch') {
        releaseTouchAutomation(track.id, parameterId);
    }
};

const commitLevelGesture = (
    action: Parameters<typeof executeAppAction>[0],
    track: Track,
    parameterId: LevelParameter,
    clearGesture: () => void
): void => {
    void (async () => {
        try {
            await executeAppAction(action);
        } catch (error) {
            logger.error(new Error(`Inspector level commit failed for action: ${action.type}`, { cause: error }));
            restoreEngineFromProjectTruth(track, parameterId);
        } finally {
            clearGesture();
            releaseTouch(track, parameterId);
        }
    })();
};

export const TrackLevelSection = ({ track }: TrackLevelSectionProps): ReactElement => {
    const [localGain, setLocalGain] = useState<number | null>(null);
    const [localPan, setLocalPan] = useState<number | null>(null);

    const activeGain = localGain !== null ? localGain : track.gain;
    const activePan = localPan !== null ? localPan : track.pan;

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
                             * control share one scale. The travel is the fader
                             * law's own ceiling rather than a flat 100: a track
                             * pushed into the fader's `+6 dB` of headroom from
                             * the mixer reads `150%` here, and a control that
                             * stopped at 100 would write that make-up gain away
                             * on first touch.
                             *
                             * Pointer/key release disarms Touch recording even
                             * when the gesture ended on the start value and
                             * never dispatched — same split as the mixer fader.
                             */}
                            <div
                                role="presentation"
                                className="w-full"
                                data-testid="inspector-track-gain-release"
                                onPointerUp={() => releaseTouch(track, 'gain')}
                                onKeyUp={() => releaseTouch(track, 'gain')}
                            >
                                <Slider
                                    value={[activeGain * 100]}
                                    onValueChange={([value]) => {
                                        if (value === undefined) {
                                            return;
                                        }
                                        const gain = value / 100;
                                        setLocalGain(gain);
                                        setTrackGain(track.id, gain, true);
                                    }}
                                    onValueCommit={([value]) => {
                                        if (value === undefined) {
                                            return;
                                        }
                                        const gain = value / 100;
                                        setLocalGain(gain);
                                        commitLevelGesture(
                                            {
                                                type: 'setTrackGain',
                                                payload: { trackId: track.id, gain, expectedGain: track.gain },
                                            },
                                            track,
                                            'gain',
                                            () => setLocalGain(null)
                                        );
                                    }}
                                    max={FADER_MAX_GAIN * 100}
                                    step={1}
                                    aria-label={`${track.name} gain`}
                                    data-testid="inspector-track-gain"
                                    className="w-full"
                                />
                            </div>
                        </Row>
                    </Stack>
                </SurfaceCard>
                <SurfaceCard className="w-full p-3">
                    <Row gap={3} className="w-full">
                        <Stack justify="center" grow gap={1.5} className="min-w-0 overflow-hidden">
                            <label className="text-[10px] font-medium text-foreground truncate w-full">Pan</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{formatPan(activePan)}</span>
                            <Row gap={1.5} className="mt-0.5">
                                <MidiLearnButton targetType="trackPan" trackId={track.id} />
                            </Row>
                        </Stack>
                        <Row
                            justify="center"
                            shrink={false}
                            data-testid="inspector-track-pan"
                            onPointerUp={() => releaseTouch(track, 'pan')}
                            onKeyUp={() => releaseTouch(track, 'pan')}
                        >
                            <RotaryKnob
                                value={activePan}
                                onChange={(value, isTransient) => {
                                    if (isTransient) {
                                        setLocalPan(value);
                                        setTrackPan(track.id, value, true);
                                        return;
                                    }
                                    setLocalPan(value);
                                    commitLevelGesture(
                                        {
                                            type: 'setTrackPan',
                                            payload: { trackId: track.id, pan: value, expectedPan: track.pan },
                                        },
                                        track,
                                        'pan',
                                        () => setLocalPan(null)
                                    );
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
