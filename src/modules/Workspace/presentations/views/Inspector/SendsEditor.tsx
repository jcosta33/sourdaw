import { type ReactElement } from 'react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Slider } from '#/components/ui/slider';
import { Button } from '#/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { useTracks } from '../../hooks/useTracks';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';
import { setSend, toggleSendPreFader, addTrack } from '#/modules/Arrangement';
import { type Track } from '../../../models/TrackViewTypes';

type SendsEditorProps = {
    track: Track;
};

export const SendsEditor = ({ track }: SendsEditorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const buses = allTracks.filter((t) => t.kind === 'bus');

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Sends" />
            {buses.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {buses.map((bus) => {
                        const send = track.sends.find((s) => s.busId === bus.id);
                        const level = send?.level ?? 0;
                        const isPreFader = send?.preFader ?? false;
                        return (
                            <SurfaceCard key={bus.id} className="w-full p-3">
                                <div className="flex flex-col w-full gap-2">
                                    <ControlHeader
                                        className="w-full"
                                        label={bus.name}
                                        labelClassName="max-w-[50%] truncate font-medium text-foreground"
                                        value={
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                                                    {(level * 100).toFixed(0)}%
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
                                            </div>
                                        }
                                        valueClassName="font-normal"
                                        title={bus.name}
                                    />
                                    <div className="w-full px-1 flex items-center justify-center">
                                        <Slider
                                            value={[level * 100]}
                                            onValueChange={([v]) => {
                                                if (v !== undefined) {
                                                    setSend(track.id, bus.id, v / 100);
                                                }
                                            }}
                                            max={100}
                                            step={1}
                                            aria-label={`Send to ${bus.name}`}
                                            className="w-full"
                                        />
                                    </div>
                                </div>
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
