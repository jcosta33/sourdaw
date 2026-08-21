import { type ReactElement } from 'react';

import { Plus } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { setSend, toggleSendPreFader, addTrack } from '#/modules/Arrangement/useCases';
import { gainToDb, levelToSendPosition, sendPositionToLevel } from '#/utils/audioLevelLaw';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';
import { useTracks } from '../../hooks/useTracks';

type SendsEditorProps = {
    track: Track;
};

/**
 * Sends read out in decibels, matching the control law (FX-7). A percentage of
 * a linear amplitude is not a level a mixing engineer can act on: "50%" is
 * -6 dB, not half as loud.
 */
function formatSendLevel(level: number): string {
    if (level <= 0) {
        return '-∞ dB';
    }
    return `${gainToDb(level).toFixed(1)} dB`;
}
export const SendsEditor = ({ track }: SendsEditorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const buses = allTracks.filter((time) => time.kind === 'bus');

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Sends" />
            {buses.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {buses.map((bus) => {
                        const send = track.sends.find((state) => state.busId === bus.id);
                        const level = send?.level ?? 0;
                        const isPreFader = send?.preFader ?? false;
                        return (
                            <SurfaceCard key={bus.id} className="w-full p-3">
                                <Stack gap={2} className="w-full">
                                    <ControlHeader
                                        className="w-full"
                                        label={bus.name}
                                        labelClassName="max-w-[50%] truncate font-medium text-foreground"
                                        value={
                                            <Row gap={1.5}>
                                                <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                                                    {formatSendLevel(level)}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="shrink-0"
                                                    onClick={() => toggleSendPreFader(track.id, bus.id)}
                                                    aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                                                    title={
                                                        isPreFader
                                                            ? 'Pre-fader (click for post)'
                                                            : 'Post-fader (click for pre)'
                                                    }
                                                >
                                                    <DawMicroBadge
                                                        tone={isPreFader ? 'peach' : 'muted'}
                                                        className={cn(
                                                            'transition-colors',
                                                            !isPreFader && 'hover:text-foreground'
                                                        )}
                                                    >
                                                        {isPreFader ? 'PRE' : 'POST'}
                                                    </DawMicroBadge>
                                                </button>
                                            </Row>
                                        }
                                        valueClassName="font-normal"
                                        title={bus.name}
                                    />
                                    <Row justify="center" className="w-full px-1">
                                        <Slider
                                            value={[Math.round(levelToSendPosition(level))]}
                                            onValueChange={([value]) => {
                                                if (value !== undefined) {
                                                    setSend(track.id, bus.id, sendPositionToLevel(value));
                                                }
                                            }}
                                            max={100}
                                            step={1}
                                            aria-label={`Send to ${bus.name}`}
                                            className="w-full"
                                        />
                                    </Row>
                                </Stack>
                            </SurfaceCard>
                        );
                    })}
                </div>
            ) : (
                <DawEmptyState
                    compact
                    className="mx-1"
                    title="No bus tracks yet"
                    description="Create a bus to start sharing signal between tracks."
                    action={
                        <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                                addTrack({ name: `Bus ${buses.length + 1}`, kind: 'bus' });
                            }}
                        >
                            <Plus className="size-3 mr-1" />
                            Create Bus
                        </Button>
                    }
                />
            )}
        </div>
    );
};
