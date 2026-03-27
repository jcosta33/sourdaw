import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { Slider } from '#/components/ui/slider';
import { Button } from '#/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { useTracks } from '../../hooks/useTracks';
import { setSend, toggleSendPreFader } from '#/modules/Arrangement/useCases/device/sendManagement';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type Track } from '#/modules/Arrangement/models/Track';

type SendsEditorProps = {
    track: Track;
};

export const SendsEditor = ({ track }: SendsEditorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const buses = allTracks.filter((t) => t.kind === 'bus');

    return (
        <div>
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 flex flex-row items-center justify-between">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sends</div>
            </div>
            {buses.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {buses.map((bus) => {
                        const send = track.sends.find((s) => s.busId === bus.id);
                        const level = send?.level ?? 0;
                        const isPreFader = send?.preFader ?? false;
                        return (
                            <Card
                                key={bus.id}
                                className="rounded-md shadow-none bg-surface-base border-border/50 p-3 w-full"
                            >
                                <div className="flex flex-col w-full gap-2">
                                    <div className="flex items-center justify-between w-full">
                                        <label
                                            className="text-[10px] font-medium text-foreground truncate max-w-[50%]"
                                            title={bus.name}
                                        >
                                            {bus.name}
                                        </label>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                                                {(level * 100).toFixed(0)}%
                                            </span>
                                            <button
                                                type="button"
                                                className={cn(
                                                    'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-tight transition-colors border',
                                                    isPreFader
                                                        ? 'bg-[var(--color-state-warning)]/15 text-[var(--color-state-warning)] border-[var(--color-state-warning)]/30 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]'
                                                        : 'bg-bg-panel text-muted-foreground border-border-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.3)] hover:text-foreground'
                                                )}
                                                onClick={() => toggleSendPreFader(track.id, bus.id)}
                                                aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                                                title={
                                                    isPreFader
                                                        ? 'Pre-fader (click for post)'
                                                        : 'Post-fader (click for pre)'
                                                }
                                            >
                                                {isPreFader ? 'PRE' : 'POST'}
                                            </button>
                                        </div>
                                    </div>
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
                            </Card>
                        );
                    })}
                </div>
            ) : (
                <div className="px-1">
                    <p className="text-[10px] text-muted-foreground mb-2">No bus tracks. Create a bus to add sends.</p>
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
                </div>
            )}
        </div>
    );
};
