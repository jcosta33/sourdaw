import { type ReactElement, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { Button } from '#/components/ui/button';
import { useTracks } from '../../hooks/useTracks';
import { setTrackOutput } from '#/modules/Arrangement/useCases/toggleTrackState/setTrackOutput';
import { type Track } from '../../../models/TrackViewTypes';
import { MixerMicroReadout } from '../../components/Mixer/MixerMicroReadout';
import { MixerSection } from '../../components/Mixer/MixerSection';

type IOSectionProps = {
    track: Track;
};

export const IOSection = ({ track }: IOSectionProps): ReactElement => {
    const [outputOpen, setOutputOpen] = useState(false);
    const { tracks } = useTracks();
    const buses = tracks.filter((t) => t.kind === 'bus');

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
                    <div
                        className="daw-floating-surface absolute bottom-full right-0 z-50 mb-1 min-w-20 rounded-md py-1"
                        role="listbox"
                        aria-label="Output routing"
                    >
                        {outputTargets.map((target) => (
                            <button
                                type="button"
                                key={target.id}
                                role="option"
                                aria-selected={track.outputId === target.id}
                                className={cn(
                                    'w-full px-2 py-1 text-left text-[10px] transition-colors hover:bg-white/[0.06]',
                                    track.outputId === target.id && 'font-medium text-primary'
                                )}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTrackOutput(track.id, target.id);
                                    setOutputOpen(false);
                                }}
                            >
                                {target.label}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </MixerSection>
    );
};
