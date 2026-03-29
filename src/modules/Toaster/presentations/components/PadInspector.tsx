/**
 * Pad Inspector — selected pad's controls in a single horizontal row.
 * Designed to sit in a full-width horizontal strip. No wrapping.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type PadState, type DrumEngineType } from '../../models/ToasterKit';

type PadInspectorProps = {
    pad: PadState;
    onParamChange: (key: string, value: number) => void;
    onEngineChange: (engine: DrumEngineType) => void;
};

const ALL_ENGINES: Array<{ id: DrumEngineType; label: string; group: string }> = [
    { id: 'kick-808', label: '808 Kick', group: 'Kick' },
    { id: 'kick-909', label: '909 Kick', group: 'Kick' },
    { id: 'kick-analog', label: 'Analog Kick', group: 'Kick' },
    { id: 'snare-808', label: '808 Snare', group: 'Snare' },
    { id: 'snare-analog', label: 'Analog Snare', group: 'Snare' },
    { id: 'hihat-closed', label: 'Closed Hat', group: 'Hi-Hat' },
    { id: 'hihat-open', label: 'Open Hat', group: 'Hi-Hat' },
    { id: 'clap', label: 'Clap', group: 'Perc' },
    { id: 'tom', label: 'Tom', group: 'Perc' },
    { id: 'cymbal', label: 'Cymbal', group: 'Perc' },
    { id: 'cowbell', label: 'Cowbell', group: 'Perc' },
    { id: 'clave', label: 'Clave', group: 'Perc' },
    { id: 'rimshot', label: 'Rimshot', group: 'Perc' },
    { id: 'shaker', label: 'Shaker', group: 'Perc' },
    { id: 'perc-generic', label: 'Generic', group: 'Perc' },
    { id: 'modal-tabla', label: 'Tabla', group: 'Physical' },
    { id: 'modal-bongo', label: 'Bongo', group: 'Physical' },
    { id: 'modal-woodblock', label: 'Woodblock', group: 'Physical' },
    { id: 'modal-metal', label: 'Metal Hit', group: 'Physical' },
    { id: 'fm-perc', label: 'FM Metallic', group: 'FM' },
];

const groups = [...new Set(ALL_ENGINES.map((e) => e.group))];

const K = ({ value, onChange, label, min, max, step, defaultValue, sz }: {
    value: number; onChange: (v: number) => void; label: string;
    min: number; max: number; step: number; defaultValue: number; sz?: 'sm' | 'md' | 'lg' | 'xl';
}): ReactElement => (
    <div className="flex flex-col items-center gap-0 shrink-0">
        <RotaryKnob value={value} onChange={onChange} min={min} max={max} step={step} defaultValue={defaultValue} size={sz ?? 'lg'} />
        <span className="text-[7px] text-muted-foreground leading-tight">{label}</span>
    </div>
);

export const PadInspector = ({ pad, onParamChange, onEngineChange }: PadInspectorProps): ReactElement => (
    <div className="flex items-center gap-3 min-w-0">
        {/* Pad identity + engine */}
        <div className="shrink-0 flex items-center gap-2 w-[130px]">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pad.color }} />
            <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold text-foreground truncate">{pad.name}</div>
                <select
                    value={pad.engineType}
                    onChange={(e) => onEngineChange(e.target.value as DrumEngineType)}
                    className="w-full h-5 rounded border border-border/30 bg-surface-inset px-1 text-[8px] text-foreground cursor-pointer"
                >
                    {groups.map((group) => (
                        <optgroup key={group} label={group}>
                            {ALL_ENGINES.filter((e) => e.group === group).map((e) => (
                                <option key={e.id} value={e.id}>{e.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-border/20 shrink-0" />

        {/* All knobs small — this strip must be compact */}
        <K value={pad.decay} onChange={(v) => onParamChange('decay', v)} label="Decay" min={0} max={1} step={0.01} defaultValue={0.5} sz="sm" />
        <K value={pad.tone} onChange={(v) => onParamChange('tone', v)} label="Tone" min={0} max={1} step={0.01} defaultValue={0.5} sz="sm" />
        <K value={pad.drive} onChange={(v) => onParamChange('drive', v)} label="Drive" min={0} max={10} step={0.1} defaultValue={0} sz="sm" />
        <div className="w-px h-6 bg-border/20 shrink-0" />
        <K value={pad.volume} onChange={(v) => onParamChange('volume', v)} label="Vol" min={0} max={1} step={0.01} defaultValue={0.8} sz="sm" />
        <K value={pad.pan} onChange={(v) => onParamChange('pan', v)} label="Pan" min={-1} max={1} step={0.01} defaultValue={0} sz="sm" />
        <div className="w-px h-6 bg-border/20 shrink-0" />
        <K value={pad.filterCutoff} onChange={(v) => onParamChange('filterCutoff', v)} label="Cut" min={20} max={20000} step={10} defaultValue={20000} sz="sm" />
        <K value={pad.sendReverb} onChange={(v) => onParamChange('sendReverb', v)} label="Rev" min={0} max={1} step={0.01} defaultValue={0.1} sz="sm" />
        <K value={pad.sendDelay} onChange={(v) => onParamChange('sendDelay', v)} label="Dly" min={0} max={1} step={0.01} defaultValue={0} sz="sm" />
    </div>
);
