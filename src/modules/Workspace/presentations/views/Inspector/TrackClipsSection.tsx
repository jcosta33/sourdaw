import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Check, X, Sparkles } from 'lucide-react';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';
import { acceptGhostClip } from '#/modules/Arrangement/useCases/clip/acceptGhostClip';
import { dismissGhostClip } from '#/modules/Arrangement/useCases/clip/dismissGhostClip';

type TrackClipsSectionProps = {
    track: Track;
    onSelectClip: (id: string) => void;
};

export const TrackClipsSection = ({ track, onSelectClip }: TrackClipsSectionProps): ReactElement => {
    return (
        <div>
            <div
                className="px-2 py-1.5 mb-2 rounded-sm text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.03)',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}
            >
                <span>Clips ({track.clips.length})</span>
            </div>
            {track.clips.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {track.clips.map((clip) => (
                        <Card
                            key={clip.id}
                            className={`rounded-md shadow-none bg-surface-base p-2 cursor-pointer hover:bg-surface-raised flex flex-col justify-center ${
                                clip.isGhost ? 'border-[var(--color-accent-lavender)]/60 border-dashed' : 'border-border/50'
                            }`}
                            onClick={() => {
                                onSelectClip(clip.id);
                            }}
                        >
                            <div className="flex items-center gap-1.5">
                                {clip.isGhost ? <Sparkles className="size-3 text-[var(--color-accent-lavender)] shrink-0" /> : null}
                                <span className="text-xs text-foreground font-medium truncate">{clip.name}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                                bar {Math.floor(clip.startBeat / 4) + 1}–{Math.floor(clip.endBeat / 4) + 1}
                            </span>
                            {clip.isGhost ? (
                                <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-border/30">
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        className="h-5 flex-1 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            acceptGhostClip(clip.id);
                                        }}
                                    >
                                        <Check className="size-3 mr-1" /> Accept
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="h-5 flex-1 text-[10px] text-muted-foreground hover:text-destructive"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            dismissGhostClip(clip.id);
                                        }}
                                    >
                                        <X className="size-3 mr-1" /> Dismiss
                                    </Button>
                                </div>
                            ) : null}
                        </Card>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground px-1 italic">No crumbs here — record or drag in a clip.</p>
            )}
        </div>
    );
};
