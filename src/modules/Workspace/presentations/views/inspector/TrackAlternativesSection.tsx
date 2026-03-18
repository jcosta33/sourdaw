import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import {
    handleCreateTrackAlternative,
    handleSwitchTrackAlternative,
    handleDeleteTrackAlternative,
} from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackAlternativesSectionProps = {
    track: Track;
};

export const TrackAlternativesSection = ({ track }: TrackAlternativesSectionProps): ReactElement => {
    return (
        <section>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Alternatives</h3>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                        const name = `Alt ${track.alternatives.length + 1}`;
                        handleCreateTrackAlternative({
                            type: 'createTrackAlternative',
                            payload: { trackId: track.id, name, duplicateActive: false },
                        });
                    }}
                    aria-label="Create new alternative"
                    title="New empty alternative"
                >
                    <Plus className="size-3" />
                </Button>
            </div>
            <div className="space-y-1">
                {track.alternatives.map((alt) => (
                    <div
                        key={alt.id}
                        className={cn(
                            'flex items-center justify-between rounded px-2 py-1 text-xs cursor-pointer transition-colors',
                            alt.id === track.activeAlternativeId
                                ? 'bg-primary/20 text-primary'
                                : 'text-muted-foreground hover:bg-accent/50'
                        )}
                        onClick={() => {
                            if (alt.id !== track.activeAlternativeId) {
                                handleSwitchTrackAlternative({
                                    type: 'switchTrackAlternative',
                                    payload: { trackId: track.id, alternativeId: alt.id },
                                });
                            }
                        }}
                    >
                        <span className="truncate">{alt.name}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                            <span className="text-[9px] text-muted-foreground/60">{alt.clips.length}c</span>
                            {track.alternatives.length > 1 && (
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="size-4"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteTrackAlternative({
                                            type: 'deleteTrackAlternative',
                                            payload: { trackId: track.id, alternativeId: alt.id },
                                        });
                                    }}
                                    aria-label={`Delete ${alt.name}`}
                                >
                                    <Trash2 className="size-2.5" />
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
