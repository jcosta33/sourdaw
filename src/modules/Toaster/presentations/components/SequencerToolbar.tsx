/**
 * Sequencer toolbar — Euclidean generator, groove selector, pattern tools.
 * Sits above the step grid.
 */
import { type ReactElement, useState } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { GROOVE_TEMPLATES } from '../../models/GrooveTemplates';
import { applyEuclideanToTrack } from '../../useCases/applyEuclidean';

type SequencerToolbarProps = {
    selectedPadIndex: number;
    swing: number;
    onSwingChange: (v: number) => void;
    onGrooveSelect: (offsets: number[]) => void;
};

export const SequencerToolbar = ({
    selectedPadIndex, swing, onSwingChange, onGrooveSelect,
}: SequencerToolbarProps): ReactElement => {
    const [eucHits, setEucHits] = useState(4);
    const [eucSteps, setEucSteps] = useState(16);
    const [eucRot, setEucRot] = useState(0);

    return (
        <div className="flex items-center gap-3 px-2 py-1 border-b border-border/20">
            {/* Euclidean generator */}
            <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-medium text-muted-foreground uppercase tracking-wider">Euclid</span>
                <div className="flex items-center gap-1">
                    <input type="number" value={eucHits} onChange={(e) => setEucHits(Math.max(0, Math.min(32, Number(e.target.value))))}
                        className="w-8 h-5 rounded border border-border/40 bg-surface-inset px-1 text-[9px] text-center text-foreground outline-none" />
                    <span className="text-[8px] text-muted-foreground">/</span>
                    <input type="number" value={eucSteps} onChange={(e) => setEucSteps(Math.max(1, Math.min(64, Number(e.target.value))))}
                        className="w-8 h-5 rounded border border-border/40 bg-surface-inset px-1 text-[9px] text-center text-foreground outline-none" />
                    <span className="text-[8px] text-muted-foreground">r</span>
                    <input type="number" value={eucRot} onChange={(e) => setEucRot(Math.max(0, Number(e.target.value)))}
                        className="w-7 h-5 rounded border border-border/40 bg-surface-inset px-1 text-[9px] text-center text-foreground outline-none" />
                </div>
                <button type="button"
                    className="px-1.5 py-0.5 rounded text-[7px] font-medium bg-[var(--color-accent-peach)]/80 text-white hover:bg-[var(--color-accent-peach)] transition-colors"
                    onClick={() => applyEuclideanToTrack(selectedPadIndex, eucHits, eucSteps, eucRot)}
                >Apply</button>
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-border/20" />

            {/* Groove template selector */}
            <div className="flex items-center gap-1">
                <span className="text-[8px] font-medium text-muted-foreground uppercase tracking-wider">Groove</span>
                <select
                    className="h-5 rounded border border-border/40 bg-surface-inset px-1 text-[8px] text-foreground cursor-pointer"
                    onChange={(e) => {
                        const template = GROOVE_TEMPLATES[Number(e.target.value)];
                        if (template) { onGrooveSelect(template.offsets); }
                    }}
                >
                    {GROOVE_TEMPLATES.map((t, i) => (
                        <option key={t.name} value={i}>{t.name}</option>
                    ))}
                </select>
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-border/20" />

            {/* Swing */}
            <div className="flex items-center gap-1">
                <RotaryKnob value={swing} onChange={onSwingChange} min={0} max={1} step={0.01} defaultValue={0} size="sm" />
                <span className="text-[7px] text-muted-foreground">Swing</span>
            </div>
        </div>
    );
};
