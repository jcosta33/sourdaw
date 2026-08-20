import { type ReactElement } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { executeAppAction } from '#/modules/Command/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { ChoiceCard } from '../../components/Inspector/ChoiceCard';

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
                            void executeAppAction({
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
                    <ChoiceCard
                        key={alt.id}
                        className="flex flex-col justify-center"
                        selected={alt.id === track.activeAlternativeId}
                        onClick={() => {
                            if (alt.id !== track.activeAlternativeId) {
                                void executeAppAction({
                                    type: 'switchTrackAlternative',
                                    payload: { trackId: track.id, alternativeId: alt.id },
                                });
                            }
                        }}
                    >
                        <Row justify="between" className="w-full">
                            <span className="truncate text-xs font-medium text-foreground">{alt.name}</span>
                            <Row gap={0.5} shrink={false}>
                                <DawMicroBadge className="mr-1">{alt.clips.length}c</DawMicroBadge>
                                {track.alternatives.length > 1 ? (
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="h-6 w-6"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void executeAppAction({
                                                type: 'deleteTrackAlternative',
                                                payload: { trackId: track.id, alternativeId: alt.id },
                                            });
                                        }}
                                        aria-label={`Delete ${alt.name}`}
                                    >
                                        <Trash2 className="size-3 text-muted-foreground" />
                                    </Button>
                                ) : null}
                            </Row>
                        </Row>
                    </ChoiceCard>
                ))}
            </div>
        </div>
    );
};
