import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackClipsSectionProps = {
    track: Track;
    onSelectClip: (id: string) => void;
};

export const TrackClipsSection = ({ track, onSelectClip }: TrackClipsSectionProps): ReactElement => {
    return (
        <div>
            <div className="px-1 mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                <span>Clips ({track.clips.length})</span>
            </div>
            {track.clips.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {track.clips.map((clip) => (
                        <Card
                            key={clip.id}
                            className="rounded-md shadow-none bg-surface-base border-border/50 p-2 cursor-pointer hover:bg-surface-raised flex flex-col justify-center"
                            onClick={() => {
                                onSelectClip(clip.id);
                            }}
                        >
                            <span className="text-xs text-foreground font-medium truncate">{clip.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                                bar {Math.floor(clip.startBeat / 4) + 1}–{Math.floor(clip.endBeat / 4) + 1}
                            </span>
                        </Card>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground px-1">No clips on this track.</p>
            )}
        </div>
    );
};
