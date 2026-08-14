/**
 * YeastPanel — MIDI Effects Rack with 5-level progressive disclosure.
 *
 * Level 1 (Play):   Arp on/off, mode, rate, latch
 * Level 2 (Shape):  Gate, swing, octave, velocity, scale/chord
 * Level 3 (Build):  Rack view with add/remove/reorder modules
 * Level 4 (Route):  Keyboard split zones, CC routing
 * Level 5 (Lab):    Euclidean, Markov, mutation, groove template
 */
import { type ComponentProps, type ReactElement, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack, Grid } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { getStraightGrooveTemplateId, getSupportedGrooveSubdivisions } from '#/modules/MIDI/useCases';

import { createDefaultPattern, type ArpStep } from '../../models/ArpPattern';
import { PROCESSOR_TYPES } from '../../models/ProcessorCatalog';
import { yeastStore, type YeastProcessorInfo, type YeastState } from '../../stores/yeastStore';
import { addYeastProcessor } from '../../useCases/addYeastProcessor';
import { getYeastGrooveAssignment } from '../../useCases/getYeastGrooveAssignment';
import { removeYeastProcessor } from '../../useCases/removeYeastProcessor';
import { sendYeastProcessorCommand } from '../../useCases/sendYeastProcessorCommand';
import { setYeastGrooveTemplate } from '../../useCases/setYeastGrooveTemplate';
import { setYeastProcessorBypass } from '../../useCases/setYeastProcessorBypass';
import { setYeastProcessorParam } from '../../useCases/setYeastProcessorParam';
import { setYeastUiLevel } from '../../useCases/setYeastUiLevel';
import { KeyboardSplit } from '../components/KeyboardSplit';
import { ProcessorParams } from '../components/ProcessorParams';
import { StepPatternEditor } from '../components/StepPatternEditor';

import { GrooveDropTarget } from './GrooveDropTarget';
import { GrooveTemplateLifecycleControls } from './GrooveTemplateLifecycleControls';
import { YeastPreviewSurface } from './YeastPreviewSurface';

import type { YeastPreviewScope, YeastPreviewUnavailableReason } from '../YeastPreviewTypes';

const LEVEL_OPTIONS = [
    { level: 1 as const, label: 'Play', detail: 'Sprout' },
    { level: 2 as const, label: 'Shape', detail: 'Drift' },
    { level: 3 as const, label: 'Build', detail: 'Rack' },
    { level: 4 as const, label: 'Route', detail: 'Split' },
    { level: 5 as const, label: 'Lab', detail: 'Mutate' },
];

function handleSetYeastProcessorParam(id: string, name: string, value: number, isTransient?: boolean): void {
    void setYeastProcessorParam(id, name, value, isTransient).catch(() => undefined);
}

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
        titleClassName="text-[var(--color-accent-rose)]/70"
    >
        <Stack gap={2}>{children}</Stack>
    </DawPluginSectionCard>
);

const YeastChip = ({
    tone = 'rose',
    size = 'xs',
    shape = 'soft',
    caps = false,
    ...props
}: ComponentProps<typeof DawPluginChip>): ReactElement => (
    <DawPluginChip tone={tone} size={size} shape={shape} caps={caps} {...props} />
);

const YeastLed = ({ tone = 'rose', ...props }: ComponentProps<typeof DawPluginLed>): ReactElement => (
    <DawPluginLed tone={tone} {...props} />
);

const YeastKnob = ({ tone = 'rose', ...props }: ComponentProps<typeof RotaryKnob>): ReactElement => (
    <RotaryKnob tone={tone} {...props} />
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

type PreviewBinding = Readonly<{
    scope: YeastPreviewScope | null;
    unavailableReason?: YeastPreviewUnavailableReason;
}>;

function resolvePreviewBinding(trackState: TrackStoreState): PreviewBinding {
    if (!trackState.selectedTrackId) {
        return {
            scope: null,
            unavailableReason: { code: 'no-track', message: 'Select a MIDI track to preview Yeast output.' },
        };
    }
    const track = trackState.tracks.find((candidate) => candidate.id === trackState.selectedTrackId);
    if (!track) {
        return {
            scope: null,
            unavailableReason: { code: 'no-track', message: 'The selected MIDI track is unavailable.' },
        };
    }
    const yeastDevice = track.devices.find((device) => device.type === 'yeast');
    if (!yeastDevice) {
        return {
            scope: null,
            unavailableReason: { code: 'no-yeast-device', message: 'The selected track has no Yeast device.' },
        };
    }
    return {
        scope: {
            rackId: yeastDevice.id,
            routeId: track.id,
            trackId: track.id,
        },
    };
}

// ── Component ────────────────────────────────────────────────────────────────

const defaultYeastState: YeastState = {
    processors: [],
    uiLevel: 1,
};

const GROOVE_EXTRACTION_SUBDIVISIONS = getSupportedGrooveSubdivisions();

const GrooveAwareProcessorParams = ({ processor }: { processor: YeastProcessorInfo }): ReactElement => {
    const grooveState = useStore(grooveTemplateStore, defaultGrooveTemplateState);
    const [extractionSubdivision, setExtractionSubdivision] = useState('1/16');
    const assignment = getYeastGrooveAssignment(processor.id);
    const selectedGrooveTemplateId = assignment?.templateId ?? getStraightGrooveTemplateId();
    const selectedGrooveTemplate = grooveState.templates.find((template) => template.id === selectedGrooveTemplateId);
    const canEditSelectedGroove =
        selectedGrooveTemplate !== undefined &&
        selectedGrooveTemplate.id !== getStraightGrooveTemplateId() &&
        selectedGrooveTemplate.provenance.type !== 'builtin';

    return (
        <>
            <ProcessorParams
                processorId={processor.id}
                processorType={processor.type}
                params={processor.params}
                onSetParam={handleSetYeastProcessorParam}
                onCommand={sendYeastProcessorCommand}
                grooveTemplates={grooveState.templates.map(({ id, name }) => ({ id, name }))}
                selectedGrooveTemplateId={selectedGrooveTemplateId}
                grooveAmount={assignment?.amount ?? processor.params?.amount ?? 0.5}
                onSetGrooveTemplate={setYeastGrooveTemplate}
            />
            {processor.type === 'groove' ? (
                <div className="flex flex-col gap-1 px-1">
                    <label className="flex items-center justify-between gap-1 text-[7px] text-muted-foreground">
                        Extraction subdivision
                        <DawCompactSelect
                            aria-label="Groove extraction subdivision"
                            value={extractionSubdivision}
                            onChange={(event) => setExtractionSubdivision(event.target.value)}
                        >
                            {GROOVE_EXTRACTION_SUBDIVISIONS.map((subdivision) => (
                                <option key={subdivision} value={subdivision}>
                                    {subdivision}
                                </option>
                            ))}
                        </DawCompactSelect>
                    </label>
                    <GrooveDropTarget subdivision={extractionSubdivision} />
                </div>
            ) : null}
            {processor.type === 'groove' && canEditSelectedGroove ? (
                <GrooveTemplateLifecycleControls
                    templateId={selectedGrooveTemplate.id}
                    templateName={selectedGrooveTemplate.name}
                />
            ) : null}
        </>
    );
};

export const YeastPanel = (): ReactElement => {
    const state = useStore(yeastStore, defaultYeastState);
    const trackState = useStore(trackStore, defaultTrackState);

    const { uiLevel } = state;
    const levelMeta = getLevelMeta(uiLevel);
    const previewBinding = resolvePreviewBinding(trackState);

    return (
        <div className="yeast-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <Grid gap={3} className="h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_16rem]">
                <aside className="min-h-0 overflow-y-auto pr-1">
                    <Stack gap={3}>
                        <SideCard
                            title="Rack frame"
                            detail="Levels stay docked here so the instrument keeps one identity."
                        >
                            <Stack gap={1}>
                                {LEVEL_OPTIONS.map((entry) => {
                                    const active = uiLevel === entry.level;
                                    return (
                                        <Row
                                            key={entry.label}
                                            as="button"
                                            justify="between"
                                            gap={3}
                                            className={`yeast-window px-3 py-2 text-left transition-all ${
                                                active
                                                    ? 'border-white/18 bg-white/[0.03]'
                                                    : 'hover:border-white/12 hover:bg-white/[0.02]'
                                            }`}
                                            onClick={() => setYeastUiLevel(entry.level)}
                                        >
                                            <span className="text-[11px] font-medium text-foreground">
                                                {entry.label}
                                            </span>
                                            <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/45">
                                                {entry.detail}
                                            </span>
                                        </Row>
                                    );
                                })}
                            </Stack>
                        </SideCard>

                        <SideCard title="Sprout" detail="Keep a few immediate transforms one tap away.">
                            <Row wrap gap={1.5}>
                                {PROCESSOR_TYPES.filter((processor) => processor.level <= 2).map((processor) => (
                                    <YeastChip key={processor.type} onClick={() => addYeastProcessor(processor.type)}>
                                        + {processor.name}
                                    </YeastChip>
                                ))}
                            </Row>
                        </SideCard>
                    </Stack>
                </aside>

                <Stack gap={3} className="min-h-0">
                    <div className="yeast-window p-3">
                        <Row justify="between" align="start" gap={3}>
                            <Stack gap={2}>
                                <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/70">
                                    Note rack
                                </div>
                                <div className="text-[16px] font-semibold text-foreground">{levelMeta.title}</div>
                                <span className="sr-only">{levelMeta.description}</span>
                            </Stack>

                            <Row wrap justify="end" gap={2}>
                                <MetricTile
                                    label="Flow"
                                    value={`${state.processors.length}`}
                                    detail="Active transforms"
                                />
                                <MetricTile
                                    label="Deck"
                                    value={LEVEL_OPTIONS[uiLevel - 1]?.label ?? 'Play'}
                                    detail="Current focus"
                                />
                                <MetricTile
                                    label="Chord"
                                    value={
                                        state.processors.some((processor) => processor.type === 'chord') ? 'On' : 'Off'
                                    }
                                    detail="Harmony memory"
                                />
                            </Row>
                        </Row>
                    </div>

                    <YeastPreviewSurface
                        scope={previewBinding.scope}
                        unavailableReason={previewBinding.unavailableReason}
                        processors={state.processors}
                        runtimeStatus={state.runtimeStatus}
                        runtimeError={state.runtimeError}
                    />

                    <div className="yeast-window min-h-0 flex-1 overflow-auto p-3">{renderDeck(state)}</div>
                </Stack>

                <aside className="min-h-0 overflow-y-auto pr-1">
                    <SideCard title="Rack read" detail="Transforms stay visible even when you are focused on one deck.">
                        <Stack gap={1.5}>
                            {state.processors.length > 0 ? (
                                state.processors.map((processor) => (
                                    <Row
                                        key={processor.id}
                                        justify="between"
                                        gap={3}
                                        className="yeast-window px-3 py-2"
                                    >
                                        <Stack>
                                            <div className="text-[11px] font-medium text-foreground">
                                                {processor.name}
                                            </div>
                                            <div className="text-[8px] uppercase tracking-[0.18em] text-muted-foreground/45">
                                                {processor.type}
                                            </div>
                                        </Stack>
                                        <YeastLed className={processor.bypassed ? 'opacity-50' : undefined}>
                                            {processor.bypassed ? 'Bypass' : 'Live'}
                                        </YeastLed>
                                    </Row>
                                ))
                            ) : (
                                <div className="yeast-window px-3 py-3 text-[10px] leading-4 text-muted-foreground">
                                    No processors yet. Add one from the sprout shelf and the note lanes will wake up.
                                </div>
                            )}
                        </Stack>
                    </SideCard>
                </aside>
            </Grid>
        </div>
    );
};

// ── Level 1: Play ────────────────────────────────────────────────────────────

const Level1Play = ({ state }: { state: YeastState }): ReactElement => {
    const arp = state.processors.find((param) => param.type === 'arpeggiator');
    const hasArp = arp !== undefined;
    // Latch is processor param state, not view state: handleSetYeastProcessorParam
    // commits it to yeastStore, and a reload or undo that restores the
    // arpeggiator must restore its latch with it.
    const latchOn = arp?.params?.latch === 1;

    return (
        <Row align="center" justify="center" gap={8} className="flex-1 px-8">
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
                    if (arp) {
                        removeYeastProcessor(arp.id);
                    } else {
                        addYeastProcessor('arpeggiator');
                    }
                }}
            >
                {hasArp ? 'Arp On' : 'Arp Off'}
            </DawPluginToggle>
            {/* Mode */}
            <Stack align="center" gap={1}>
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Mode</span>
                <DawCompactSelect
                    size="micro"
                    tone="inset"
                    className="min-w-[4.5rem]"
                    aria-label="Mode"
                    onChange={(event) => {
                        if (arp) {
                            handleSetYeastProcessorParam(arp.id, 'mode', parseInt(event.target.value));
                        }
                    }}
                    value={arp?.params?.mode ?? 0}
                >
                    <option value={0}>Up</option>
                    <option value={1}>Down</option>
                    <option value={2}>Up-Down</option>
                    <option value={3}>Down-Up</option>
                    <option value={4}>Random</option>
                    <option value={5}>Order</option>
                    <option value={6}>Chord</option>
                    <option value={7}>Pattern</option>
                </DawCompactSelect>
            </Stack>
            {/* Rate */}
            <Stack align="center" gap={1}>
                <span className="text-[8px] text-muted-foreground uppercase tracking-widest">Rate</span>
                <YeastKnob
                    aria-label="Rate"
                    value={arp?.params?.rate_denom ?? 8}
                    onChange={(value) => {
                        if (arp) {
                            handleSetYeastProcessorParam(arp.id, 'rate_denom', Math.round(value));
                        }
                    }}
                    min={1}
                    max={32}
                    step={1}
                    defaultValue={8}
                    size="lg"
                />
                <span className="text-[8px] text-muted-foreground font-mono">1/{arp?.params?.rate_denom ?? 8}</span>
            </Stack>
            {/* Latch */}
            <YeastChip
                size="sm"
                active={latchOn}
                aria-pressed={latchOn}
                onClick={() => {
                    const next = !latchOn;
                    if (arp) {
                        handleSetYeastProcessorParam(arp.id, 'latch', next ? 1 : 0);
                    }
                }}
            >
                Latch
            </YeastChip>
        </Row>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const Level2Shape = ({ state }: { state: YeastState }): ReactElement => {
    const arp = state.processors.find((param) => param.type === 'arpeggiator');

    return (
        <Row align="start" justify="around" className="flex-1 px-4 py-3">
            <KnobCol
                label="Gate"
                value={arp?.params?.gate ?? 0.8}
                onChange={(value) => {
                    if (!arp) {
                        return;
                    }
                    handleSetYeastProcessorParam(arp.id, 'gate', value);
                }}
                min={0.01}
                max={2}
                unit="%"
            />
            <KnobCol
                label="Swing"
                value={arp?.params?.swing ?? 0}
                onChange={(value) => {
                    if (!arp) {
                        return;
                    }
                    handleSetYeastProcessorParam(arp.id, 'swing', value);
                }}
                min={0}
                max={1}
                unit="%"
            />
            <KnobCol
                label="Octaves"
                value={arp?.params?.octave_range ?? 1}
                onChange={(value) => {
                    if (!arp) {
                        return;
                    }
                    handleSetYeastProcessorParam(arp.id, 'octave_range', value);
                }}
                min={1}
                max={4}
                unit=""
            />
            <KnobCol
                label="Velocity"
                value={arp?.params?.fixed_velocity ?? 100}
                onChange={(value) => {
                    if (!arp) {
                        return;
                    }
                    handleSetYeastProcessorParam(arp.id, 'fixed_velocity', value);
                }}
                min={1}
                max={127}
                unit=""
            />
        </Row>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

const Level3Build = ({ state }: { state: YeastState }): ReactElement => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [arpPattern, setArpPattern] = useState<ArpStep[]>(() => createDefaultPattern(8));
    const hasArpPattern = state.processors.some((param) => param.type === 'arpeggiator');

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
        <Stack gap={2} className="flex-1 px-3 py-2 overflow-y-auto">
            {/* Rack chain with expandable params */}
            <Stack gap={1}>
                {state.processors.map((proc, index) => (
                    <div key={proc.id} className="rounded bg-surface-base/50 border border-border/20 overflow-hidden">
                        {/* Header row */}
                        <Row
                            align="center"
                            gap={2}
                            className="px-2 py-1.5 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}
                        >
                            <span className="text-[7px] text-muted-foreground/50 w-3">{index + 1}</span>
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
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setYeastProcessorBypass(proc.id, !proc.bypassed);
                                }}
                            >
                                {proc.bypassed ? 'Off' : 'On'}
                            </DawPluginToggle>
                            <button
                                type="button"
                                className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    removeYeastProcessor(proc.id);
                                }}
                            >
                                ✕
                            </button>
                        </Row>

                        {/* Expanded parameter panel */}
                        {expandedId === proc.id ? (
                            <div className="border-t border-border/10 bg-surface-app/30">
                                <GrooveAwareProcessorParams processor={proc} />
                            </div>
                        ) : null}
                    </div>
                ))}
            </Stack>
            {/* Arp pattern editor (when arp is present) */}
            {hasArpPattern ? (
                <Stack gap={1} className="border-t border-border/20 pt-2">
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest block">
                        Arp Pattern
                    </span>
                    <StepPatternEditor
                        steps={arpPattern}
                        currentStep={0}
                        onStepChange={handleStepChange}
                        onLengthChange={handleLengthChange}
                    />
                </Stack>
            ) : null}
            {/* Add processor */}
            <Row wrap gap={1} className="pt-1 border-t border-border/20">
                {PROCESSOR_TYPES.filter((pt) => pt.level <= 3).map((pt) => (
                    <YeastChip key={pt.type} onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                        + {pt.name}
                    </YeastChip>
                ))}
            </Row>
        </Stack>
    );
};

// ── Level 4: Route ───────────────────────────────────────────────────────────

const Level4Route = ({ state }: { state: YeastState }): ReactElement => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    return (
        <Stack gap={2} className="flex-1 px-3 py-2 overflow-y-auto">
            {/* Keyboard visualization */}
            <Stack gap={1}>
                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-widest block">Keyboard</span>
                <KeyboardSplit width={500} height={32} />
            </Stack>
            {/* Rack chain with params */}
            <Stack gap={1}>
                {state.processors.map((proc, index) => (
                    <div key={proc.id} className="rounded bg-surface-base/50 border border-border/20 overflow-hidden">
                        <Row
                            align="center"
                            gap={2}
                            className="px-2 py-1.5 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}
                        >
                            <span className="text-[7px] text-muted-foreground/50 w-3">{index + 1}</span>
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
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setYeastProcessorBypass(proc.id, !proc.bypassed);
                                }}
                            >
                                {proc.bypassed ? 'Off' : 'On'}
                            </DawPluginToggle>
                            <button
                                type="button"
                                className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    removeYeastProcessor(proc.id);
                                }}
                            >
                                ✕
                            </button>
                        </Row>
                        {expandedId === proc.id ? (
                            <div className="border-t border-border/10 bg-surface-app/30">
                                <GrooveAwareProcessorParams processor={proc} />
                            </div>
                        ) : null}
                    </div>
                ))}
            </Stack>
            {/* Add — includes Route-level processors */}
            <Row wrap gap={1} className="pt-1 border-t border-border/20">
                {PROCESSOR_TYPES.filter((pt) => pt.level <= 4).map((pt) => (
                    <YeastChip key={pt.type} onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                        + {pt.name}
                    </YeastChip>
                ))}
            </Row>
        </Stack>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const Level5Lab = ({ state }: { state: YeastState }): ReactElement => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [arpPattern, setArpPattern] = useState<ArpStep[]>(() => createDefaultPattern(16));

    return (
        <Row grow className="min-h-0 overflow-hidden">
            {/* Left: Rack + generative tools */}
            <Stack gap={2} className="flex-1 px-3 py-2 overflow-y-auto">
                {/* Rack chain with params */}
                <Stack gap={1}>
                    {state.processors.map((proc, index) => (
                        <div
                            key={proc.id}
                            className="rounded bg-surface-base/50 border border-border/20 overflow-hidden"
                        >
                            <Row
                                align="center"
                                gap={2}
                                className="px-2 py-1.5 cursor-pointer"
                                onClick={() => setExpandedId(expandedId === proc.id ? null : proc.id)}
                            >
                                <span className="text-[7px] text-muted-foreground/50 w-3">{index + 1}</span>
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
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setYeastProcessorBypass(proc.id, !proc.bypassed);
                                    }}
                                >
                                    {proc.bypassed ? 'Off' : 'On'}
                                </DawPluginToggle>
                                <button
                                    type="button"
                                    className="text-[7px] text-muted-foreground hover:text-[var(--color-state-danger)] cursor-pointer"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        removeYeastProcessor(proc.id);
                                    }}
                                >
                                    ✕
                                </button>
                            </Row>
                            {expandedId === proc.id ? (
                                <div className="border-t border-border/10 bg-surface-app/30">
                                    <GrooveAwareProcessorParams processor={proc} />
                                </div>
                            ) : null}
                        </div>
                    ))}
                </Stack>

                {/* All processors */}
                <Stack gap={1} className="pt-1 border-t border-border/20">
                    <span className="w-full text-[7px] text-muted-foreground/50 uppercase tracking-widest">
                        Generative
                    </span>
                    <Row wrap gap={1}>
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
                    </Row>
                    <span className="w-full text-[7px] text-muted-foreground/50 uppercase tracking-widest mt-1">
                        Standard
                    </span>
                    <Row wrap gap={1}>
                        {PROCESSOR_TYPES.filter((pt) => pt.level <= 4).map((pt) => (
                            <YeastChip key={pt.type} onClick={() => addYeastProcessor(pt.type)} title={pt.description}>
                                + {pt.name}
                            </YeastChip>
                        ))}
                    </Row>
                </Stack>
            </Stack>
            {/* Right: Pattern editor + keyboard */}
            <Stack gap={2} className="w-[280px] shrink-0 border-l border-border/20 p-2 overflow-y-auto">
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
            </Stack>
        </Row>
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
    <Stack align="center" gap={1}>
        <span className="text-[8px] text-muted-foreground uppercase tracking-widest">{label}</span>
        <YeastKnob
            aria-label={label}
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={0.01}
            defaultValue={value}
            size="md"
        />
        <span className="text-[7px] text-muted-foreground font-mono">
            {value.toFixed(unit === '%' ? 0 : 1)}
            {unit}
        </span>
    </Stack>
);
