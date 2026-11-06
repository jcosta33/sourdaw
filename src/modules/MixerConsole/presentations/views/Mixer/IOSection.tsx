import { type ReactElement, useRef, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { commitTrackOutput, listTrackOutputDestinations } from '#/modules/Arrangement/useCases';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { type Track } from '../../../models/TrackViewTypes';
import { MixerMicroReadout } from '../../components/Mixer/MixerMicroReadout';
import { MixerSection } from '../../components/Mixer/MixerSection';
import { useTracks } from '../../hooks/useTracks';

import { MixerPopupMenu, MixerPopupOption } from './MixerPopupMenu';

type IOSectionProps = {
    track: Track;
};

function resolveOutputLabel(outputId: string, tracks: readonly Track[]): string {
    if (outputId === 'master') {
        return 'Master';
    }
    return tracks.find((candidate) => candidate.id === outputId)?.name ?? outputId;
}

export const IOSection = ({ track }: IOSectionProps): ReactElement => {
    const [outputOpen, setOutputOpen] = useState(false);
    const outputRef = useRef<HTMLDivElement>(null);
    const { tracks } = useTracks();
    const destinations = listTrackOutputDestinations(track.id, tracks);
    useContextMenuDismiss(outputRef, () => setOutputOpen(false));

    const inputLabel = track.kind === 'midi' ? 'MIDI In' : 'Default';
    const outputLabel = resolveOutputLabel(track.outputId, tracks);

    const outputTargets: { id: string; label: string }[] = [
        { id: 'master', label: 'Master' },
        ...destinations.map((bus) => ({ id: bus.id, label: bus.name })),
    ];

    return (
        <MixerSection label="I/O">
            <MixerMicroReadout label="In" value={inputLabel} />
            <div className="relative">
                <MixerMicroReadout
                    label="Out"
                    endSlot={
                        <Button
                            variant="ghost"
                            size="xs"
                            className="flex h-5 max-w-16 items-center gap-0.5 truncate px-1 text-[10px]"
                            onClick={(event) => {
                                event.stopPropagation();
                                setOutputOpen(!outputOpen);
                            }}
                            aria-haspopup="listbox"
                            aria-expanded={outputOpen}
                        >
                            <span className="truncate">{outputLabel}</span>
                            <ChevronDown className="size-2 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Button>
                    }
                />

                {outputOpen ? (
                    <MixerPopupMenu
                        ref={outputRef}
                        className="bottom-full right-0 mb-1 min-w-20"
                        role="listbox"
                        aria-label="Output routing"
                    >
                        {outputTargets.map((target) => (
                            <MixerPopupOption
                                key={target.id}
                                role="option"
                                active={track.outputId === target.id}
                                aria-selected={track.outputId === target.id}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void commitTrackOutput({
                                        trackId: track.id,
                                        outputId: target.id,
                                        expectedOutputId: track.outputId,
                                    });
                                    setOutputOpen(false);
                                }}
                            >
                                {target.label}
                            </MixerPopupOption>
                        ))}
                    </MixerPopupMenu>
                ) : null}
            </div>
        </MixerSection>
    );
};
