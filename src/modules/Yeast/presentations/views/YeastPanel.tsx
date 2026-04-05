/**
 * YeastPanel — MIDI Effects Rack with 5-level progressive disclosure.
 *
 * Level 1 (Play):   Arp on/off, mode, rate, latch
 * Level 2 (Shape):  Gate, swing, octave, velocity, scale/chord
 * Level 3 (Build):  Rack view with add/remove/reorder modules
 * Level 4 (Route):  Keyboard split zones, CC routing
 * Level 5 (Lab):    Euclidean, Markov, mutation, groove template
 */
import { type ComponentProps, type ReactElement, useState, useSyncExternalStore } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { yeastStore, type YeastState } from '../../stores/yeastStore';
import { addYeastProcessor } from '../../useCases/addYeastProcessor';
import { removeYeastProcessor } from '../../useCases/removeYeastProcessor';
import { setYeastProcessorBypass } from '../../useCases/setYeastProcessorBypass';
import { setYeastProcessorParam } from '../../useCases/setYeastProcessorParam';
import { setYeastUiLevel } from '../../useCases/setYeastUiLevel';
import { PROCESSOR_TYPES } from '../../useCases/processorFactory';
import { ProcessorParams } from '../components/ProcessorParams';
import { StepPatternEditor } from '../components/StepPatternEditor';
import { KeyboardSplit } from '../components/KeyboardSplit';
import { createDefaultPattern, type ArpStep } from '../../models/ArpPattern';

const LEVEL_OPTIONS = [
    { level: 1 as const, label: 'Play', detail: 'Sprout' },
    { level: 2 as const, label: 'Shape', detail: 'Drift' },
    { level: 3 as const, label: 'Build', detail: 'Rack' },
    { level: 4 as const, label: 'Route', detail: 'Split' },
    { level: 5 as const, label: 'Lab', detail: 'Mutate' },
];

const MetricTile = ({ label, value, detail }: { label: string; value: string; detail: string }): ReactElement => (
    <DawPluginMetricTile className="yeast-window min-w-[92px]" label={label} value={value} detail={detail} />
);

const SideCard = ({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactElement | ReactElement[];
}): ReactElement => (
    <DawPluginSectionCard
        className="yeast-window"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-peach)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

const YeastChip = ({
    tone = 'peach',
    size = 'xs',
    shape = 'soft',
    caps = false,
    ...props
}: ComponentProps<typeof DawPluginChip>): ReactElement => (
    <DawPluginChip tone={tone} size={size} shape={shape} caps={caps} {...props} />
);

const YeastLed = ({ tone = 'peach', ...props }: ComponentProps<typeof DawPluginLed>): ReactElement => (
    <DawPluginLed tone={tone} {...props} />
);

function getLevelMeta(level: YeastState['uiLevel']): { title: string; description: string } {
    if (level === 1) {
        return {
            title: 'Note flow',
            description: 'Immediate arp moves, latch, and rate stay right under the phrase view.',
        };
    }

    if (level === 2) {
        return {
            title: 'Phrase shape',
            description: 'Gate, swing, spread, and velocity should feel like motion, not raw values.',
        };
    }

    if (level === 3) {
        return {
            title: 'Rack build',
            description: 'The transform chain stays musical while you add, remove, or open modules.',
        };
    }

    if (level === 4) {
        return {
            title: 'Split map',
            description: 'Zones and routes belong in the same frame as the note motion they control.',
        };
    }

    return {
        title: 'Pattern lab',
        description: 'Mutation, Markov, Euclid, and groove templates live in the strange corner on purpose.',
    };
}

function renderDeck(state: YeastState): ReactElement {
    if (state.uiLevel === 1) {
        return <Level1Play state={state} />;
    }

    if (state.uiLevel === 2) {
        return <Level2Shape state={state} />;
    }

    if (state.uiLevel === 3) {
        return <Level3Build state={state} />;
    }

    if (state.uiLevel === 4) {
        return <Level4Route state={state} />;
    }

    return <Level5Lab state={state} />;
}

const NoteFlowHero = ({ state }: { state: YeastState }): ReactElement => {
    const laneCount = Math.max(3, Math.min(7, state.processors.length + 2));

    return (
        <div className="yeast-window flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] font-medium text-foreground">Phrase view</div>
                    <div className="text-[9px] text-muted-foreground">
                        A quick motion sketch for whatever the rack is doing right now.
                    </div>
                </div>
                <YeastLed>{state.processors.length} modules</YeastLed>
            </div>

            <div className="space-y-2">
                {Array.from({ length: laneCount }, (_, index) => {
                    const width = 24 + ((index * 17 + state.uiLevel * 11) % 68);
                    const offset = (index * 9 + state.uiLevel * 7) % 36;
                    return (
                        <div key={index} className="h-4 rounded-full bg-white/5 px-1 py-1">
                            <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent-peach),var(--color-accent-cyan))]"
                                style={{
                                    width: `${width}%`,
                                    marginLeft: `${offset}%`,
                                    opacity: 0.8 - index * 0.07,
                                }}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ── Component ────────────────────────────────────────────────────────────────

export const YeastPanel = (): ReactElement => {
    const state = useSyncExternalStore<YeastState | null>(
        (cb) => yeastStore.subscribe(cb),
        () => yeastStore.value
    );

    if (!state) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs italic">
                Activating the yeast...
            </div>
        );
    }

    const { uiLevel } = state;
    const levelMeta = getLevelMeta(uiLevel);

    return (
        <div className="yeast-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_16rem] gap-3">
                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SideCard title="Rack frame" detail="Levels stay docked here so the instrument keeps one identity.">
                        <div className="flex flex-col gap-1">
                            {LEVEL_OPTIONS.map((entry) => {
                                const active = uiLevel === entry.level;
                                return (
                                    <button
                                        key={entry.label}
                                        type="button"
                                        className={`yeast-window flex items-center justify-between px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-white/18 bg-white/[0.03]'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                        onClick={() => setYeastUiLevel(entry.level)}
                                    >
                                        <span className="text-[11px] font-medium text-foreground">{entry.label}</span>
                                        <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/45">
                                            {entry.detail}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </SideCard>

                    <SideCard title="Sprout" detail="Keep a few immediate transforms one tap away.">
                        <div className="flex flex-wrap gap-1.5">
                            {PROCESSOR_TYPES.filter((processor) => processor.level <= 2).map((processor) => (
                                <YeastChip key={processor.type} onClick={() => addYeastProcessor(processor.type)}>
                                    + {processor.name}
                                </YeastChip>
                            ))}
                        </div>
                    </SideCard>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/70">
                                Note rack
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{levelMeta.title}</div>
                            <span className="sr-only">{levelMeta.description}</span>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                            <MetricTile label="Flow" value={`${state.processors.length}`} detail="Active transforms" />
                            <MetricTile
                                label="Deck"
                                value={LEVEL_OPTIONS[uiLevel - 1]?.label ?? 'Play'}
                                detail="Current focus"
                            />
                            <MetricTile
                                label="Chord"
                                value={state.processors.some((processor) => processor.type === 'chord') ? 'On' : 'Off'}
                                detail="Harmony memory"
                            />
                        </div>
                    </div>

                    <NoteFlowHero state={state} />

                    <div className="yeast-window min-h-0 flex-1 overflow-auto p-3">{renderDeck(state)}</div>
                </section>

                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SideCard title="Rack read" detail="Transforms stay visible even when you are focused on one deck.">
                        <div className="flex flex-col gap-1.5">
                            {state.processors.length > 0 ? (
                                state.processors.map((processor) => (
                                    <div
                                        key={processor.id}
                                        className="yeast-window flex items-center justify-between px-3 py-2"
                                    >
                                        <div>
                                            <div className="text-[11px] font-medium text-foreground">
                                                {processor.name}
                                            </div>
                                            <div className="text-[8px] uppercase tracking-[0.18em] text-muted-foreground/45">
                                                {processor.type}
                                            </div>
                                        </div>
                                        <YeastLed className={processor.bypassed ? 'opacity-50' : undefined}>
                                            {processor.bypassed ? 'Bypass' : 'Live'}
                                        </YeastLed>
                                    </div>
                                ))
                            ) : (
                                <div className="yeast-window px-3 py-3 text-[10px] leading-4 text-muted-foreground">
                                    No processors yet. Add one from the sprout shelf and the note lanes will wake up.
                                </div>
                            )}
                        </div>
                    </SideCard>
                </aside>
            </div>
        </div>
    );
};

// ── Level 1: Play ────────────────────────────────────────────────────────────

const Level1Play = ({ state }: { state: YeastState }): ReactElement => {
    const hasArp = state.processors.some((p) => p.type === 'arpeggiator');

    return (
        <div className="flex-1 flex items-center justify-center gap-8 px-8">
            {/* Arp On/Off */}
            <DawPluginToggle
                pressed={hasArp}
                tone="peach"
                size="sm"
                shape="soft"
                onLabel="Arp On"
                offLabel="Arp Off"
                caps
                onClick={() => {
                    if (hasArp) {
                        const arp = state.processors.find((p) => p.type === 'arpeggiator');
                        if (arp) removeYeastProcessor(arp.id);
                    } else {
                        addYeastProcessor('arpeggiator');
                    }
                }}
            >
                {hasArp ? 'Arp On' : 'Arp Off'}
            </DawPluginToggle>

            {/* Mode */}
            <div className="flex flex-col items-center gap-1">
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Mode</span>
                <DawCompactSelect
                    size="micro"
                    tone="inset"
                    className="min-w-[4.5rem]"
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
                </DawCompactSelect>
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
                    min={1}
                    max={32}
                    step={1}
                    defaultValue={8}
                    size="lg"
                />
                <span className="text-[8px] text-muted-foreground font-mono">1/8</span>
            </div>

            {/* Latch */}
            <YeastChip
                size="sm"
                onClick={() => {
                    const arp = state.processors.find((p) => p.type === 'arpeggiator');
                    if (arp) setYeastProcessorParam(arp.id, 'latch', 1);
                }}
            >
                Latch
            </YeastChip>
        </div>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const Level2Shape = ({ state }: { state: YeastState }): ReactElement => {
    const arp = state.processors.find((p) => p.type === 'arpeggiator');

    return (
        <div className="flex-1 flex items-start justify-around px-4 py-3">
            <KnobCol
                label="Gate"
                value={0.8}
                onChange={(v) => arp && setYeastProcessorParam(arp.id, 'gate', v)}
                min={0.01}
                max={2}
                unit="%"
            />
            <KnobCol
                label="Swing"
                value={0}
                onChange={(v) => arp && setYeastProcessorParam(arp.id, 'swing', v)}
                min={0}
                max={1}
                unit="%"
            />
            <KnobCol
                label="Octaves"
                value={1}
                onChange={(v) => arp && setYeastProcessorParam(arp.id, 'octave_range', v)}
                min={1}
                max={4}
                unit=""
            />
            <KnobCol
                label="Velocity"
                value={100}
                onChange={(v) => arp && setYeastProcessorParam(arp.id, 'fixed_velocity', v)}
                min={1}
                max={127}
                unit=""
            />
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
                        <div
                            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}
                        >
                            <span className="text-[7px] text-muted-foreground/50 w-3">{i + 1}</span>
                            <span
                                className={`text-[6px] ${expandedId === proc.id ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/30'}`}
                            >
                                {expandedId === proc.id ? '▼' : '▶'}
                            </span>
                            <span
                                className={`text-[10px] font-medium flex-1 ${proc.bypassed ? 'text-muted-foreground/40 line-through' : 'text-foreground'}`}
                            >
                                {proc.name}
                            </span>
                            <DawPluginToggle
                                pressed={!proc.bypassed}
                                tone="peach"
                                size="xs"
                                shape="soft"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setYeastProcessorBypass(proc.id, !proc.bypassed);
                                }}
                            >
                                {proc.bypassed ? 'Off' : 'On'}
                            </DawPluginToggle>
                            <button
                                type="button"
                                className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeYeastProcessor(proc.id);
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Expanded parameter panel */}
                        {expandedId === proc.id ? (
                            <div className="border-t border-border/10 bg-surface-app/30">
                                <ProcessorParams
                                    processorId={proc.id}
                                    processorType={proc.type}
                                    onSetParam={setYeastProcessorParam}
                                />
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            {/* Arp pattern editor (when arp is present) */}
            {hasArpPattern ? (
                <div className="border-t border-border/20 pt-2">
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest block mb-1">
                        Arp Pattern
                    </span>
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
                    <YeastChip key={pt.type} onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                        + {pt.name}
                    </YeastChip>
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
                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest block mb-1">
                    Keyboard
                </span>
                <KeyboardSplit width={500} height={32} />
            </div>

            {/* Rack chain with params */}
            <div className="flex flex-col gap-1">
                {state.processors.map((proc, i) => (
                    <div key={proc.id} className="rounded bg-surface-base/50 border border-border/20 overflow-hidden">
                        <div
                            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}
                        >
                            <span className="text-[7px] text-muted-foreground/50 w-3">{i + 1}</span>
                            <span
                                className={`text-[6px] ${expandedId === proc.id ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/30'}`}
                            >
                                {expandedId === proc.id ? '▼' : '▶'}
                            </span>
                            <span
                                className={`text-[10px] font-medium flex-1 ${proc.bypassed ? 'text-muted-foreground/40 line-through' : 'text-foreground'}`}
                            >
                                {proc.name}
                            </span>
                            <DawPluginToggle
                                pressed={!proc.bypassed}
                                tone="peach"
                                size="xs"
                                shape="soft"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setYeastProcessorBypass(proc.id, !proc.bypassed);
                                }}
                            >
                                {proc.bypassed ? 'Off' : 'On'}
                            </DawPluginToggle>
                            <button
                                type="button"
                                className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeYeastProcessor(proc.id);
                                }}
                            >
                                ✕
                            </button>
                        </div>
                        {expandedId === proc.id ? (
                            <div className="border-t border-border/10 bg-surface-app/30">
                                <ProcessorParams
                                    processorId={proc.id}
                                    processorType={proc.type}
                                    onSetParam={setYeastProcessorParam}
                                />
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            {/* Add — includes Route-level processors */}
            <div className="flex flex-wrap gap-1 pt-1 border-t border-border/20">
                {PROCESSOR_TYPES.filter((pt) => pt.level <= 4).map((pt) => (
                    <YeastChip key={pt.type} onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                        + {pt.name}
                    </YeastChip>
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
                        <div
                            key={proc.id}
                            className="rounded bg-surface-base/50 border border-border/20 overflow-hidden"
                        >
                            <div
                                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                                onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}
                            >
                                <span className="text-[7px] text-muted-foreground/50 w-3">{i + 1}</span>
                                <span
                                    className={`text-[6px] ${expandedId === proc.id ? 'text-[var(--color-accent-peach)]' : 'text-muted-foreground/30'}`}
                                >
                                    {expandedId === proc.id ? '▼' : '▶'}
                                </span>
                                <span
                                    className={`text-[10px] font-medium flex-1 ${proc.bypassed ? 'text-muted-foreground/40 line-through' : 'text-foreground'}`}
                                >
                                    {proc.name}
                                </span>
                                <DawPluginToggle
                                    pressed={!proc.bypassed}
                                    tone="peach"
                                    size="xs"
                                    shape="soft"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setYeastProcessorBypass(proc.id, !proc.bypassed);
                                    }}
                                >
                                    {proc.bypassed ? 'Off' : 'On'}
                                </DawPluginToggle>
                                <button
                                    type="button"
                                    className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeYeastProcessor(proc.id);
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                            {expandedId === proc.id ? (
                                <div className="border-t border-border/10 bg-surface-app/30">
                                    <ProcessorParams
                                        processorId={proc.id}
                                        processorType={proc.type}
                                        onSetParam={setYeastProcessorParam}
                                    />
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>

                {/* All processors */}
                <div className="flex flex-wrap gap-1 pt-1 border-t border-border/20">
                    <span className="w-full text-[7px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">
                        Generative
                    </span>
                    {PROCESSOR_TYPES.filter((pt) => pt.level === 5).map((pt) => (
                        <YeastChip
                            key={pt.type}
                            tone="mint"
                            onClick={() => addYeastProcessor(pt.type)}
                            title={pt.description}
                        >
                            + {pt.name}
                        </YeastChip>
                    ))}
                    <span className="w-full text-[7px] text-muted-foreground/50 uppercase tracking-widest mt-1 mb-0.5">
                        Standard
                    </span>
                    {PROCESSOR_TYPES.filter((pt) => pt.level <= 4).map((pt) => (
                        <YeastChip key={pt.type} onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                            + {pt.name}
                        </YeastChip>
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

const KnobCol = ({
    label,
    value,
    onChange,
    min,
    max,
    unit,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    unit: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <span className="text-[8px] text-muted-foreground uppercase tracking-widest">{label}</span>
        <RotaryKnob value={value} onChange={onChange} min={min} max={max} step={0.01} defaultValue={value} size="md" />
        <span className="text-[7px] text-muted-foreground font-mono">
            {value.toFixed(unit === '%' ? 0 : 1)}
            {unit}
        </span>
    </div>
);
