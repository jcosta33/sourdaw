import { type ReactElement } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import {
    handleCreateTrackAlternative,
    handleSwitchTrackAlternative,
    handleDeleteTrackAlternative,
} from '#/modules/Command/useCases/trackAlternativeHandlers';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

type TrackAlternativesSectionProps = {
    track: Track;
};

export const TrackAlternativesSection = ({ track }: TrackAlternativesSectionProps): ReactElement => {
    return (
        <div>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Alternatives"
                actions={
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
                }
            />
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                {track.alternatives.map((alt) => (
                    <Card
                        key={alt.id}
                        className={cn(
                            'flex flex-col justify-center rounded-md shadow-none bg-surface-base border-border/50 p-2 cursor-pointer transition-colors',
                            alt.id === track.activeAlternativeId ? 'ring-1 ring-primary/30' : 'hover:bg-surface-raised'
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
                        <div className="flex items-center justify-between w-full">
                            <span className="truncate text-xs font-medium text-foreground">{alt.name}</span>
                            <div className="flex items-center gap-0.5 shrink-0">
                                <span className="text-[10px] text-muted-foreground mr-1">{alt.clips.length}c</span>
                                {track.alternatives.length > 1 ? (
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteTrackAlternative({
                                                type: 'deleteTrackAlternative',
                                                payload: { trackId: track.id, alternativeId: alt.id },
                                            });
                                        }}
                                        aria-label={`Delete ${alt.name}`}
                                    >
                                        <Trash2 className="size-3 text-muted-foreground" />
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
};
