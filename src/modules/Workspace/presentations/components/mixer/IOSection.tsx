import { type ReactElement, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { useTracks } from '../../hooks/useTracks';
import { setTrackOutput } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type IOSectionProps = {
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
        <div className="w-full space-y-0.5 border-t border-border/30 pt-1.5 mt-1">
            <label className="text-[7px] text-muted-foreground/60 block text-center uppercase tracking-wider">
                I/O
            </label>

            <div className="flex items-center justify-between px-0.5">
                <span className="text-[6px] text-muted-foreground/50 uppercase">In</span>
                <span className="text-[7px] text-muted-foreground truncate max-w-16 text-right">{inputLabel}</span>
            </div>

            <div className="relative flex items-center justify-between px-0.5">
                <span className="text-[6px] text-muted-foreground/50 uppercase">Out</span>
                <button
                    type="button"
                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] text-foreground hover:bg-muted/30 transition-colors max-w-16 truncate"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOutputOpen(!outputOpen);
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={outputOpen}
                >
                    <span className="truncate">{outputLabel}</span>
                    <ChevronDown className="size-2 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>

                {outputOpen && (
                    <div
                        className="absolute bottom-full right-0 z-50 mb-1 min-w-20 rounded-md border border-border bg-surface-raised py-1 shadow-lg"
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
                                    'w-full px-2 py-1 text-left text-[8px] hover:bg-accent transition-colors',
                                    track.outputId === target.id && 'text-primary font-medium'
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
                )}
            </div>
        </div>
    );
};
