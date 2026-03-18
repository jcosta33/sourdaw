import { type ReactElement } from 'react';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackClipsSectionProps = {
    track: Track;
    onSelectClip: (id: string) => void;
};

export const TrackClipsSection = ({ track, onSelectClip }: TrackClipsSectionProps): ReactElement => {
    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Clips ({track.clips.length})
            </h3>
            {track.clips.length > 0 ? (
                <div className="space-y-1">
                    {track.clips.map((clip) => (
                        <div
                            key={clip.id}
                            className="rounded bg-surface-overlay px-2 py-1.5 cursor-pointer hover:bg-accent/50"
                            onClick={() => {
                                onSelectClip(clip.id);
                            }}
                        >
                            <span className="text-xs text-foreground">{clip.name}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground">
                                bar {Math.floor(clip.startBeat / 4) + 1}–{Math.floor(clip.endBeat / 4) + 1}
                            </span>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground">No clips on this track.</p>
            )}
        </section>
    );
};
