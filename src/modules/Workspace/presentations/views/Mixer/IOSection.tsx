import { type ReactElement, useRef, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { setTrackOutput } from '#/modules/Arrangement/useCases';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { type Track } from '../../../models/TrackViewTypes';
import { MixerMicroReadout } from '../../components/Mixer/MixerMicroReadout';
import { MixerSection } from '../../components/Mixer/MixerSection';
import { useTracks } from '../../hooks/useTracks';

import { MixerPopupMenu, MixerPopupOption } from './MixerPopupMenu';

type IOSectionProps = {
    track: Track;
};

export const IOSection = ({ track }: IOSectionProps): ReactElement => {
    const [outputOpen, setOutputOpen] = useState(false);
    const outputRef = useRef<HTMLDivElement>(null);
    const { tracks } = useTracks();
    const buses = tracks.filter((t) => t.kind === 'bus');
    useContextMenuDismiss(outputRef, () => setOutputOpen(false));

    const inputLabel = track.kind === 'midi' ? 'MIDI In' : 'Default';
    const outputLabel =
        track.outputId === 'master' ? 'Master' : (buses.find((b) => b.id === track.outputId)?.name ?? track.outputId);

    const outputTargets: { id: string; label: string }[] = [
        { id: 'master', label: 'Master' },
        ...buses.filter((b) => b.id !== track.id).map((b) => ({ id: b.id, label: b.name })),
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
                            onClick={(e) => {
                                e.stopPropagation();
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
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTrackOutput(track.id, target.id);
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
