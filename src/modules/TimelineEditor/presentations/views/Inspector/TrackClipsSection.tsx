import { type ReactElement } from 'react';

import { Check, GripVertical, X, Sparkles } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { acceptGhostClip, dismissGhostClip } from '#/modules/Arrangement/useCases';
import { MIDI_CLIP_DRAG_MIME_TYPE } from '#/utils/midiClipDrag';

import { type Track } from '../../../models/TrackViewTypes';
import { ChoiceCard } from '../../components/Inspector/ChoiceCard';
import { MetaText } from '../../components/Inspector/MetaText';

type TrackClipsSectionProps = {
    track: Track;
    onSelectClip: (id: string) => void;
};

export const TrackClipsSection = ({ track, onSelectClip }: TrackClipsSectionProps): ReactElement => {
    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title={`Clips (${track.clips.length})`} />
            {track.clips.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {track.clips.map((clip) => (
                        <ChoiceCard
                            key={clip.id}
                            className={`flex flex-col justify-center ${
                                clip.isGhost
                                    ? 'border-[var(--color-accent-lavender)]/60 border-dashed'
                                    : 'border-border/50'
                            }`}
                            onClick={() => {
                                onSelectClip(clip.id);
                            }}
                        >
                            <Row gap={1.5}>
                                {clip.isGhost ? (
                                    <Sparkles className="size-3 text-[var(--color-accent-lavender)] shrink-0" />
                                ) : null}
                                <span className="text-xs text-foreground font-medium truncate">{clip.name}</span>
                                {clip.isGhost ? <DawMicroBadge tone="primary">Ghost</DawMicroBadge> : null}
                                {clip.type === 'midi' && !clip.isGhost ? (
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        type="button"
                                        draggable
                                        aria-label={`Select or drag ${clip.name} as groove source`}
                                        className="ml-auto shrink-0 cursor-grab rounded-sm p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onSelectClip(clip.id);
                                        }}
                                        onDragStart={(event) => {
                                            event.stopPropagation();
                                            event.dataTransfer.effectAllowed = 'copy';
                                            event.dataTransfer.setData(MIDI_CLIP_DRAG_MIME_TYPE, clip.id);
                                            event.dataTransfer.setData('text/plain', clip.id);
                                        }}
                                    >
                                        <GripVertical aria-hidden="true" className="size-3" />
                                    </Button>
                                ) : null}
                            </Row>
                            <MetaText>
                                bar {Math.floor(clip.startBeat / 4) + 1}–{Math.floor(clip.endBeat / 4) + 1}
                            </MetaText>
                            {clip.isGhost ? (
                                <Row gap={1} className="mt-1.5 pt-1.5 border-t border-border/30">
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        className="h-5 flex-1 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            acceptGhostClip(clip.id);
                                        }}
                                    >
                                        <Check className="size-3 mr-1" /> Accept
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="h-5 flex-1 text-[10px] text-muted-foreground hover:text-destructive"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            dismissGhostClip(clip.id);
                                        }}
                                    >
                                        <X className="size-3 mr-1" /> Dismiss
                                    </Button>
                                </Row>
                            ) : null}
                        </ChoiceCard>
                    ))}
                </div>
            ) : (
                <DawEmptyState
                    compact
                    className="mx-1"
                    title="No clips on this track"
                    description="Record, drag in, or generate a clip to start editing."
                />
            )}
        </div>
    );
};
