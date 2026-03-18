import { type ReactElement } from 'react';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/helpers/Styles/cn';
import { useTracks } from '../../hooks/useTracks';
import { setSend, toggleSendPreFader } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type SendsSectionProps = {
    track: Track;
};

export const SendsSection = ({ track }: SendsSectionProps): ReactElement | null => {
    const { tracks } = useTracks();
    const buses = tracks.filter((t) => t.kind === 'bus');
    if (buses.length === 0) {
        return null;
    }

    return (
        <div className="w-full space-y-0.5">
            <label className="text-[7px] text-muted-foreground/60 block text-center uppercase tracking-wider">
                Sends
            </label>
            {buses.map((bus) => {
                const send = track.sends.find((s) => s.busId === bus.id);
                const level = send?.level ?? 0;
                const isPreFader = send?.preFader ?? false;
                return (
                    <div key={bus.id} className="flex items-center gap-0.5">
                        <span className="text-[6px] text-muted-foreground truncate w-6">{bus.name}</span>
                        <Slider
                            value={[level * 100]}
                            onValueChange={([v]) => {
                                if (v !== undefined) {
                                    setSend(track.id, bus.id, v / 100);
                                }
                            }}
                            max={100}
                            step={1}
                            className="flex-1"
                            aria-label={`Send to ${bus.name}`}
                        />
                        <button
                            type="button"
                            className={cn(
                                'shrink-0 rounded px-0.5 text-[5px] font-bold leading-tight',
                                isPreFader
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-muted/20 text-muted-foreground hover:bg-muted/30'
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleSendPreFader(track.id, bus.id);
                            }}
                            aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                            title={isPreFader ? 'Pre-fader (click for post)' : 'Post-fader (click for pre)'}
                        >
                            {isPreFader ? 'PRE' : 'POST'}
                        </button>
                    </div>
                );
            })}
        </div>
    );
};
