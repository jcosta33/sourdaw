/**
 * YeastPanel — MIDI Effects Rack with 5-level progressive disclosure.
 *
 * Level 1 (Play):   Arp on/off, mode, rate, latch
 * Level 2 (Shape):  Gate, swing, octave, velocity, scale/chord
 * Level 3 (Build):  Rack view with add/remove/reorder modules
 * Level 4 (Route):  Keyboard split zones, CC routing
 * Level 5 (Lab):    Euclidean, Markov, mutation, groove template
 */
import { type ReactElement, useSyncExternalStore, useState } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import {
    yeastStore,
    setYeastUiLevel,
    addYeastProcessor,
    removeYeastProcessor,
    setYeastProcessorBypass,
    setYeastProcessorParam,
    type YeastState,
} from '../../stores/yeastStore';
import { PROCESSOR_TYPES } from '../../useCases/processorFactory';
import { ProcessorParams } from '../components/ProcessorParams';
import { StepPatternEditor } from '../components/StepPatternEditor';
import { KeyboardSplit } from '../components/KeyboardSplit';
import { createDefaultPattern, type ArpStep } from '../../models/ArpPattern';

// ── Component ────────────────────────────────────────────────────────────────

export const YeastPanel = (): ReactElement => {
    const state = useSyncExternalStore<YeastState | null>(
        (cb) => yeastStore.subscribe(cb),
        () => yeastStore.value,
    );

    if (!state) {
        return <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs italic">Activating the yeast...</div>;
    }

    const { uiLevel } = state;

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar ─── */}
            <div
                className="flex items-center justify-between px-3 py-1 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, rgba(20,20,22,0.95) 0%, rgba(14,14,16,0.95) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                }}
            >
                <span className="text-[10px] font-bold text-[var(--color-accent-peach)] tracking-tight">Yeast</span>

                {/* Level switcher */}
                <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                    {(['Play', 'Shape', 'Build', 'Route', 'Lab'] as const).map((label, i) => {
                        const lvl = (i + 1) as 1 | 2 | 3 | 4 | 5;
                        return (
                            <button
                                key={label}
                                type="button"
                                className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors cursor-pointer ${
                                    uiLevel === lvl
                                        ? 'bg-[var(--color-accent-peach)] text-white'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                                onClick={() => setYeastUiLevel(lvl)}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                <div className="text-[8px] text-muted-foreground font-mono">
                    {state.processors.length} modules
                </div>
            </div>

            {/* ─── Body ─── */}
            {uiLevel === 1 ? (
                <Level1Play state={state} />
            ) : uiLevel === 2 ? (
                <Level2Shape state={state} />
            ) : uiLevel === 3 ? (
                <Level3Build state={state} />
            ) : uiLevel === 4 ? (
                <Level4Route state={state} />
            ) : (
                <Level5Lab state={state} />
            )}
        </div>
    );
};

// ── Level 1: Play ────────────────────────────────────────────────────────────

const Level1Play = ({ state }: { state: YeastState }): ReactElement => {
    const hasArp = state.processors.some((p) => p.type === 'arpeggiator');

    return (
        <div className="flex-1 flex items-center justify-center gap-8 px-8">
            {/* Arp On/Off */}
            <button
                type="button"
                className={`px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    hasArp
                        ? 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)] border border-[var(--color-accent-peach)]/30'
                        : 'text-muted-foreground border border-border/30 hover:text-foreground'
                }`}
                onClick={() => {
                    if (hasArp) {
                        const arp = state.processors.find((p) => p.type === 'arpeggiator');
                        if (arp) removeYeastProcessor(arp.id);
                    } else {
                        addYeastProcessor('arpeggiator');
                    }
                }}
            >
                {hasArp ? 'ARP ON' : 'ARP OFF'}
            </button>

            {/* Mode */}
            <div className="flex flex-col items-center gap-1">
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Mode</span>
                <select
                    className="h-6 rounded border border-border/40 bg-surface-inset px-2 text-[9px] text-foreground cursor-pointer"
                    onChange={(e) => {
                        const arp = state.processors.find((p) => p.type === 'arpeggiator');
                        if (arp) setYeastProcessorParam(arp.id, 'mode', parseInt(e.target.value));
                    }}
                    defaultValue={0}
                >
                    <option value={0}>Up</option>
                    <option value={1}>Down</option>
                    <option value={2}>Up-Down</option>
                    <option value={3}>Down-Up</option>
                    <option value={4}>Random</option>
                    <option value={5}>Order</option>
                    <option value={6}>Chord</option>
                </select>
            </div>

            {/* Rate */}
            <div className="flex flex-col items-center gap-1">
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Rate</span>
                <RotaryKnob
                    value={8}
                    onChange={(v) => {
                        const arp = state.processors.find((p) => p.type === 'arpeggiator');
                        if (arp) setYeastProcessorParam(arp.id, 'rate_denom', Math.round(v));
                    }}
                    min={1} max={32} step={1} defaultValue={8} size="lg"
                />
                <span className="text-[8px] text-muted-foreground font-mono">1/8</span>
            </div>

            {/* Latch */}
            <button
                type="button"
                className="px-3 py-1.5 rounded text-[9px] font-medium transition-colors cursor-pointer text-muted-foreground border border-border/30 hover:text-foreground"
                onClick={() => {
                    const arp = state.processors.find((p) => p.type === 'arpeggiator');
                    if (arp) setYeastProcessorParam(arp.id, 'latch', 1);
                }}
            >
                Latch
            </button>
        </div>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const Level2Shape = ({ state }: { state: YeastState }): ReactElement => {
    const arp = state.processors.find((p) => p.type === 'arpeggiator');

    return (
        <div className="flex-1 flex items-start justify-around px-4 py-3">
            <KnobCol label="Gate" value={0.8} onChange={(v) => arp && setYeastProcessorParam(arp.id, 'gate', v)}
                min={0.01} max={2} unit="%" />
            <KnobCol label="Swing" value={0} onChange={(v) => arp && setYeastProcessorParam(arp.id, 'swing', v)}
                min={0} max={1} unit="%" />
            <KnobCol label="Octaves" value={1} onChange={(v) => arp && setYeastProcessorParam(arp.id, 'octave_range', v)}
                min={1} max={4} unit="" />
            <KnobCol label="Velocity" value={100} onChange={(v) => arp && setYeastProcessorParam(arp.id, 'fixed_velocity', v)}
                min={1} max={127} unit="" />
        </div>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

const Level3Build = ({ state }: { state: YeastState }): ReactElement => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [arpPattern, setArpPattern] = useState<ArpStep[]>(() => createDefaultPattern(8));
    const hasArpPattern = state.processors.some((p) => p.type === 'arpeggiator');

    const handleStepChange = (index: number, step: ArpStep) => {
        const next = [...arpPattern];
        next[index] = step;
        setArpPattern(next);
    };

    const handleLengthChange = (length: number) => {
        if (length > arpPattern.length) {
            setArpPattern([...arpPattern, ...createDefaultPattern(length - arpPattern.length)]);
        } else {
            setArpPattern(arpPattern.slice(0, length));
        }
    };

    return (
        <div className="flex-1 flex flex-col px-3 py-2 gap-2 overflow-y-auto">
            {/* Rack chain with expandable params */}
            <div className="flex flex-col gap-1">
                {state.processors.map((proc, i) => (
                    <div key={proc.id} className="rounded bg-surface-base/50 border border-border/20 overflow-hidden">
                        {/* Header row */}
                        <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}>
                            <span className="text-[7px] text-muted-foreground/50 w-3">{i + 1}</span>
                            <span className={`text-[6px] ${expandedId === proc.id ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/30'}`}>
                                {expandedId === proc.id ? '▼' : '▶'}
                            </span>
                            <span className={`text-[10px] font-medium flex-1 ${proc.bypassed ? 'text-muted-foreground/40 line-through' : 'text-foreground'}`}>
                                {proc.name}
                            </span>
                            <button
                                type="button"
                                className={`text-[7px] px-1 rounded cursor-pointer ${proc.bypassed ? 'text-muted-foreground' : 'text-[var(--color-accent-peach)]'}`}
                                onClick={(e) => { e.stopPropagation(); setYeastProcessorBypass(proc.id, !proc.bypassed); }}
                            >
                                {proc.bypassed ? 'OFF' : 'ON'}
                            </button>
                            <button
                                type="button"
                                className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); removeYeastProcessor(proc.id); }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Expanded parameter panel */}
                        {expandedId === proc.id ? (
                            <div className="border-t border-border/10 bg-surface-app/30">
                                <ProcessorParams processorId={proc.id} processorType={proc.type} />
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            {/* Arp pattern editor (when arp is present) */}
            {hasArpPattern ? (
                <div className="border-t border-border/20 pt-2">
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest block mb-1">Arp Pattern</span>
                    <StepPatternEditor
                        steps={arpPattern}
                        currentStep={0}
                        onStepChange={handleStepChange}
                        onLengthChange={handleLengthChange}
                    />
                </div>
            ) : null}

            {/* Add processor */}
            <div className="flex flex-wrap gap-1 pt-1 border-t border-border/20">
                {PROCESSOR_TYPES.filter((pt) => pt.level <= 3).map((pt) => (
                    <button
                        key={pt.type}
                        type="button"
                        className="px-2 py-1 rounded text-[8px] text-muted-foreground hover:text-foreground border border-border/20 hover:border-border/40 cursor-pointer transition-colors"
                        onClick={() => addYeastProcessor(pt.type)}
                        title={pt.description}
                    >
                        + {pt.name}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ── Level 4: Route ───────────────────────────────────────────────────────────

const Level4Route = ({ state }: { state: YeastState }): ReactElement => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    return (
        <div className="flex-1 flex flex-col px-3 py-2 gap-2 overflow-y-auto">
            {/* Keyboard visualization */}
            <div>
                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest block mb-1">Keyboard</span>
                <KeyboardSplit width={500} height={32} />
            </div>

            {/* Rack chain with params */}
            <div className="flex flex-col gap-1">
                {state.processors.map((proc, i) => (
                    <div key={proc.id} className="rounded bg-surface-base/50 border border-border/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}>
                            <span className="text-[7px] text-muted-foreground/50 w-3">{i + 1}</span>
                            <span className={`text-[6px] ${expandedId === proc.id ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/30'}`}>
                                {expandedId === proc.id ? '▼' : '▶'}
                            </span>
                            <span className={`text-[10px] font-medium flex-1 ${proc.bypassed ? 'text-muted-foreground/40 line-through' : 'text-foreground'}`}>
                                {proc.name}
                            </span>
                            <button type="button" className={`text-[7px] px-1 rounded cursor-pointer ${proc.bypassed ? 'text-muted-foreground' : 'text-[var(--color-accent-peach)]'}`}
                                onClick={(e) => { e.stopPropagation(); setYeastProcessorBypass(proc.id, !proc.bypassed); }}>
                                {proc.bypassed ? 'OFF' : 'ON'}
                            </button>
                            <button type="button" className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); removeYeastProcessor(proc.id); }}>
                                ✕
                            </button>
                        </div>
                        {expandedId === proc.id ? (
                            <div className="border-t border-border/10 bg-surface-app/30">
                                <ProcessorParams processorId={proc.id} processorType={proc.type} />
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            {/* Add — includes Route-level processors */}
            <div className="flex flex-wrap gap-1 pt-1 border-t border-border/20">
                {PROCESSOR_TYPES.filter((pt) => pt.level <= 4).map((pt) => (
                    <button key={pt.type} type="button"
                        className="px-2 py-1 rounded text-[8px] text-muted-foreground hover:text-foreground border border-border/20 hover:border-border/40 cursor-pointer transition-colors"
                        onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                        + {pt.name}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const Level5Lab = ({ state }: { state: YeastState }): ReactElement => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [arpPattern, setArpPattern] = useState<ArpStep[]>(() => createDefaultPattern(16));

    return (
        <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: Rack + generative tools */}
            <div className="flex-1 flex flex-col px-3 py-2 gap-2 overflow-y-auto">
                {/* Rack chain with params */}
                <div className="flex flex-col gap-1">
                    {state.processors.map((proc, i) => (
                        <div key={proc.id} className="rounded bg-surface-base/50 border border-border/20 overflow-hidden">
                            <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}>
                                <span className="text-[7px] text-muted-foreground/50 w-3">{i + 1}</span>
                                <span className={`text-[6px] ${expandedId === proc.id ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/30'}`}>
                                    {expandedId === proc.id ? '▼' : '▶'}
                                </span>
                                <span className={`text-[10px] font-medium flex-1 ${proc.bypassed ? 'text-muted-foreground/40 line-through' : 'text-foreground'}`}>
                                    {proc.name}
                                </span>
                                <button type="button" className={`text-[7px] px-1 rounded cursor-pointer ${proc.bypassed ? 'text-muted-foreground' : 'text-[var(--color-accent-peach)]'}`}
                                    onClick={(e) => { e.stopPropagation(); setYeastProcessorBypass(proc.id, !proc.bypassed); }}>
                                    {proc.bypassed ? 'OFF' : 'ON'}
                                </button>
                                <button type="button" className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); removeYeastProcessor(proc.id); }}>
                                    ✕
                                </button>
                            </div>
                            {expandedId === proc.id ? (
                                <div className="border-t border-border/10 bg-surface-app/30">
                                    <ProcessorParams processorId={proc.id} processorType={proc.type} />
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>

                {/* All processors */}
                <div className="flex flex-wrap gap-1 pt-1 border-t border-border/20">
                    <span className="w-full text-[7px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Generative</span>
                    {PROCESSOR_TYPES.filter((pt) => pt.level === 5).map((pt) => (
                        <button key={pt.type} type="button"
                            className="px-2 py-1 rounded text-[8px] text-lime-400/80 hover:text-lime-300 border border-lime-500/20 hover:border-lime-500/40 cursor-pointer transition-colors"
                            onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                            + {pt.name}
                        </button>
                    ))}
                    <span className="w-full text-[7px] text-muted-foreground/50 uppercase tracking-widest mt-1 mb-0.5">Standard</span>
                    {PROCESSOR_TYPES.filter((pt) => pt.level <= 4).map((pt) => (
                        <button key={pt.type} type="button"
                            className="px-2 py-1 rounded text-[8px] text-muted-foreground hover:text-foreground border border-border/20 hover:border-border/40 cursor-pointer transition-colors"
                            onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                            + {pt.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Right: Pattern editor + keyboard */}
            <div className="w-[280px] shrink-0 border-l border-border/20 flex flex-col gap-2 p-2 overflow-y-auto">
                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest">Pattern Editor</span>
                <StepPatternEditor
                    steps={arpPattern}
                    currentStep={0}
                    onStepChange={(idx, step) => {
                        const next = [...arpPattern];
                        next[idx] = step;
                        setArpPattern(next);
                    }}
                    onLengthChange={(len) => {
                        if (len > arpPattern.length) {
                            setArpPattern([...arpPattern, ...createDefaultPattern(len - arpPattern.length)]);
                        } else {
                            setArpPattern(arpPattern.slice(0, len));
                        }
                    }}
                />

                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest mt-2">Keyboard</span>
                <KeyboardSplit width={260} height={28} />
            </div>
        </div>
    );
};

// ── Shared ────────────────────────────────────────────────────────────────────

const KnobCol = ({ label, value, onChange, min, max, unit }: {
    label: string; value: number; onChange: (v: number) => void;
    min: number; max: number; unit: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <span className="text-[8px] text-muted-foreground uppercase tracking-widest">{label}</span>
        <RotaryKnob value={value} onChange={onChange} min={min} max={max} step={0.01} defaultValue={value} size="md" />
        <span className="text-[7px] text-muted-foreground font-mono">
            {value.toFixed(unit === '%' ? 0 : 1)}{unit}
        </span>
    </div>
);
