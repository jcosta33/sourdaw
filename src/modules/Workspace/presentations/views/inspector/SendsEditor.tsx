import { type ReactElement } from 'react';
import { Slider } from '#/components/ui/slider';
import { Button } from '#/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { useTracks } from '../../hooks/useTracks';
import { setSend, toggleSendPreFader } from '../../../useCases/workspaceViewActions';
import { addTrack } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type SendsEditorProps = {
    track: Track;
};

export const SendsEditor = ({ track }: SendsEditorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const buses = allTracks.filter((t) => t.kind === 'bus');

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sends</h3>
            {buses.length > 0 ? (
                <div className="space-y-1.5">
                    {buses.map((bus) => {
                        const send = track.sends.find((s) => s.busId === bus.id);
                        const level = send?.level ?? 0;
                        const isPreFader = send?.preFader ?? false;
                        return (
                            <div key={bus.id} className="space-y-0.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">{bus.name}</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            className={cn(
                                                'shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-tight',
                                                isPreFader
                                                    ? 'bg-yellow-500/20 text-yellow-400'
                                                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/30'
                                            )}
                                            onClick={() => toggleSendPreFader(track.id, bus.id)}
                                            aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                                            title={
                                                isPreFader ? 'Pre-fader (click for post)' : 'Post-fader (click for pre)'
                                            }
                                        >
                                            {isPreFader ? 'PRE' : 'POST'}
                                        </button>
                                        <span className="text-[10px] font-mono text-muted-foreground">
                                            {(level * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                </div>
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
                                />
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">No bus tracks. Create a bus to add sends.</p>
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
        </section>
    );
};
