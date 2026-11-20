import { type ReactElement, useState } from 'react';

import { DawEffectDisclosure } from '#/components/daw/DawEffectDisclosure';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawSearchInput } from '#/components/daw/DawSearchInput';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { MIC_POSITION_DISPLAY_NAMES, type InstrumentId, type MicPositionState } from '../../models/LevainPatch';
import { defaultLevainState, levainStore, updateMicPosition } from '../../stores/levainStore';
import { sendMicParamToEngine } from '../../useCases/levainParamBridge/sendMicParamToEngine';
import { setLevainParamWithAudio } from '../../useCases/levainParamBridge/setLevainParamWithAudio';
import { setMacroWithAudio } from '../../useCases/levainParamBridge/setMacroWithAudio';
import { loadInstrument } from '../../useCases/loadPreset';
import { selectLevainArticulation } from '../../useCases/selectLevainArticulation';
import { setLevainPanelUiLevel } from '../../useCases/setLevainPanelUiLevel';
import { ArticulationList } from '../components/ArticulationList';
import { ExpressionPanel } from '../components/ExpressionPanel';
import { HumanizePanel } from '../components/HumanizePanel';
import { LegatoTuning } from '../components/LegatoTuning';
import { LevainMacroStrip } from '../components/LevainMacroStrip';
import { MicBlendSlider } from '../components/MicBlendSlider';
import { useLevainMasterGesture } from '../hooks/useLevainMasterGesture';

const INSTRUMENTS: { id: InstrumentId; label: string; hasSamples: boolean; family: string }[] = [
    { id: 'violin-1', label: 'Solo Violin', hasSamples: true, family: 'Strings' },
    { id: 'violin-2', label: 'Violins II', hasSamples: true, family: 'Strings' },
    { id: 'viola', label: 'Violas', hasSamples: true, family: 'Strings' },
    { id: 'cello', label: 'Cellos', hasSamples: true, family: 'Strings' },
    { id: 'double-bass', label: 'Basses', hasSamples: true, family: 'Strings' },
    { id: 'trumpet', label: 'Trumpets', hasSamples: true, family: 'Brass' },
    { id: 'horn', label: 'Horns', hasSamples: true, family: 'Brass' },
    { id: 'trombone', label: 'Trombones', hasSamples: true, family: 'Brass' },
    { id: 'tuba', label: 'Tuba', hasSamples: true, family: 'Brass' },
    { id: 'flute', label: 'Flutes', hasSamples: true, family: 'Woodwinds' },
    { id: 'piccolo', label: 'Piccolo', hasSamples: true, family: 'Woodwinds' },
    { id: 'oboe', label: 'Oboes', hasSamples: true, family: 'Woodwinds' },
    { id: 'clarinet', label: 'Clarinets', hasSamples: true, family: 'Woodwinds' },
    { id: 'bassoon', label: 'Bassoons', hasSamples: true, family: 'Woodwinds' },
    { id: 'timpani', label: 'Timpani', hasSamples: true, family: 'Percussion' },
    { id: 'glockenspiel', label: 'Glockenspiel', hasSamples: true, family: 'Percussion' },
    { id: 'marimba', label: 'Marimba', hasSamples: true, family: 'Percussion' },
    { id: 'harp', label: 'Harp', hasSamples: false, family: 'Strings' },
];

const FAMILIES = ['All', 'Strings', 'Brass', 'Woodwinds', 'Percussion'];

const SectionCard = ({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactElement | ReactElement[];
}): ReactElement => (
    <DawPluginSectionCard
        className="levain-window shrink-0"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-amber)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

export const LevainPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const instances = useStore(levainStore, {});
    const state = instances[deviceId] ?? defaultLevainState;
    const [search, setSearch] = useState('');
    const [family, setFamily] = useState('All');
    const [micSelection, setMicSelection] = useState<{
        deviceId: string;
        instrumentId: InstrumentId;
        bank: typeof state.loadedMicPositions;
        index: number;
    } | null>(null);
    const expert = state.uiLevel === 6;
    const master = useLevainMasterGesture(deviceId, expert, state.patch.masterGain);

    const { patch, currentArticulationDisplay: currentArt, engineReady, sampleLoadProgress } = state;
    const sampleLoadError = state.sampleLoadError ?? null;
    const loadedMicPositions = state.loadedMicPositions;

    // Keep null slots so the visible controls retain the engine's original mic indices.
    function toVisibleMicPosition(type: MicPositionState['type'], index: number): MicPositionState | undefined {
        const mic = patch.micPositions[index];
        if (!mic) {
            return undefined;
        }
        return { ...mic, type, name: MIC_POSITION_DISPLAY_NAMES[type] };
    }
    let visibleMicPositions: (MicPositionState | null)[] = [];
    if (loadedMicPositions) {
        visibleMicPositions = loadedMicPositions.map((type, index) =>
            type ? (toVisibleMicPosition(type, index) ?? null) : null
        );
    }
    const visibleMicCount = visibleMicPositions.filter((mic) => mic !== null).length;
    const selectedMicIndex =
        micSelection?.deviceId === deviceId &&
        micSelection.instrumentId === patch.instrumentId &&
        micSelection.bank === loadedMicPositions &&
        visibleMicPositions[micSelection.index]
            ? micSelection.index
            : null;
    const selectedMic = selectedMicIndex === null ? null : visibleMicPositions[selectedMicIndex];
    // An old selection must not revive when its former device or bank returns.
    if (micSelection !== null && selectedMicIndex === null) {
        setMicSelection(null);
    }

    // Load readout: a failure surfaces as an explicit error (not a synthetic
    // 100% then "Ready"); otherwise show the live percentage or idle "Ready".
    let loadValue = 'Ready';
    if (sampleLoadError !== null) {
        loadValue = 'Error';
    } else if (sampleLoadProgress !== null) {
        loadValue = `${Math.round(sampleLoadProgress * 100)}%`;
    }

    const instLabel =
        INSTRUMENTS.find((instrument) => instrument.id === patch.instrumentId)?.label ?? patch.instrumentId;
    const query = search.trim().toLowerCase();
    const visibleInstruments = INSTRUMENTS.filter((instrument) => {
        const matchesFamily = family === 'All' ? true : instrument.family === family;
        const matchesSearch =
            query.length === 0 ? true : `${instrument.label} ${instrument.family}`.toLowerCase().includes(query);
        return matchesFamily && matchesSearch && instrument.hasSamples;
    });

    return (
        <div className="levain-faceplate @container/levain relative h-full min-h-0 min-w-0 rounded-[26px] p-3">
            <div className="grid h-full grid-cols-1 content-start gap-3 overflow-y-auto overscroll-contain @[34rem]/levain:grid-cols-[13rem_minmax(0,1fr)] @[34rem]/levain:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @[34rem]/levain:overflow-visible @[62rem]/levain:grid-cols-[15rem_minmax(0,1fr)_17rem] @[62rem]/levain:grid-rows-[minmax(0,1fr)]">
                <Stack
                    as="aside"
                    aria-label="Instrument lineup"
                    tabIndex={0}
                    gap={3}
                    className="max-h-96 min-w-0 overflow-y-auto pr-1 @[34rem]/levain:max-h-none @[34rem]/levain:overscroll-contain"
                >
                    <Stack as="section" gap={2} shrink={false} className="levain-window p-3">
                        <Row align="start" justify="between" gap={3}>
                            <Stack gap={1}>
                                <div className="text-micro uppercase tracking-[0.26em] text-[var(--color-accent-amber)]/70">
                                    Lineup
                                </div>
                                <div className="text-[15px] font-semibold text-foreground">Levain</div>
                            </Stack>
                            <DawPluginLed
                                tone="amber"
                                role="status"
                                aria-live="polite"
                                aria-label={engineReady ? 'Engine ready' : 'Engine loading'}
                            >
                                {engineReady ? 'Ready' : 'Loading'}
                            </DawPluginLed>
                        </Row>

                        <DawSearchInput
                            value={search}
                            onChange={setSearch}
                            placeholder="Find a section"
                            aria-label="Search Levain instruments"
                            variant="ghost"
                            size="micro"
                            className="levain-window shrink-0"
                        />

                        <Row
                            align="stretch"
                            wrap
                            gap={1.5}
                            shrink={false}
                            role="radiogroup"
                            aria-label="Filter instruments by family"
                        >
                            {FAMILIES.map((entry) => {
                                const active = family === entry;
                                return (
                                    <DawPluginChip
                                        key={entry}
                                        active={active}
                                        tone="amber"
                                        size="xs"
                                        caps={false}
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setFamily(entry)}
                                    >
                                        {entry}
                                    </DawPluginChip>
                                );
                            })}
                        </Row>

                        <Stack gap={1.5}>
                            {visibleInstruments.map((instrument) => {
                                const active = patch.instrumentId === instrument.id;
                                return (
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        key={instrument.id}
                                        type="button"
                                        aria-pressed={active}
                                        aria-current={active ? 'true' : undefined}
                                        className={`levain-window flex flex-col items-start gap-1 px-3 py-2 text-left whitespace-normal transition-all ${
                                            active
                                                ? 'border-white/18 bg-white/[0.03]'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                        onClick={() => {
                                            void loadInstrument(deviceId, instrument.id, instrument.label);
                                        }}
                                    >
                                        <Row justify="between" wrap gap={1} className="w-full">
                                            <span className="wrap-anywhere text-compact font-medium text-foreground">
                                                {instrument.label}
                                            </span>
                                            <span className="text-micro uppercase tracking-[0.22em] text-muted-foreground/45">
                                                {instrument.family}
                                            </span>
                                        </Row>
                                    </Button>
                                );
                            })}
                        </Stack>
                    </Stack>

                    {expert ? (
                        <section aria-label="Articulation rail" className="levain-window shrink-0 p-2">
                            <div className="px-2 pb-2 text-micro uppercase tracking-[0.24em] text-[var(--color-accent-amber)]/70">
                                Articulation rail
                            </div>
                            <ArticulationList
                                articulations={patch.articulations}
                                current={patch.currentArticulation}
                                onSelect={(type) => {
                                    void selectLevainArticulation(deviceId, type);
                                }}
                            />
                        </section>
                    ) : null}
                </Stack>

                <Stack
                    as="section"
                    aria-label="Phrase stage"
                    tabIndex={0}
                    gap={3}
                    className="@container min-w-0 @[34rem]/levain:row-span-2 @[34rem]/levain:overflow-y-auto @[34rem]/levain:overscroll-contain @[34rem]/levain:pr-1 @[62rem]/levain:row-span-1"
                >
                    <Row align="start" justify="between" wrap gap={3} shrink={false}>
                        <Stack gap={2}>
                            <div className="text-micro uppercase tracking-[0.26em] text-[var(--color-accent-amber)]/70">
                                Phrase stage
                            </div>
                            <div className="wrap-anywhere text-[16px] font-semibold text-foreground">{instLabel}</div>
                        </Stack>

                        <Row align="stretch" wrap gap={2}>
                            <DawPluginMetricTile
                                compact
                                className="levain-window"
                                label="Artic"
                                value={currentArt}
                                detail="Selected patch articulation"
                            />
                            {expert ? (
                                <DawPluginMetricTile
                                    compact
                                    className="levain-window"
                                    label="Legato"
                                    value={patch.legato.enabled ? 'On' : 'Off'}
                                    detail="Transition engine"
                                />
                            ) : null}
                            <DawPluginMetricTile
                                compact
                                className="levain-window max-w-52"
                                label="Load"
                                role="status"
                                aria-live="polite"
                                value={loadValue}
                                valueClassName={
                                    sampleLoadError !== null ? 'text-[var(--color-state-danger)]' : undefined
                                }
                                detail={sampleLoadError !== null ? sampleLoadError : 'Sample stream'}
                                detailClassName="wrap-anywhere"
                            />
                        </Row>
                    </Row>

                    <fieldset disabled={!instances[deviceId]} className="min-w-0 shrink-0 border-0 p-0">
                        <DawEffectDisclosure
                            tier={expert ? 'lab' : 'play'}
                            options={['play', 'lab']}
                            labels={{ play: 'Basic', lab: 'Expert' }}
                            groupLabel="Levain control detail"
                            tone="amber"
                            onChange={(tier) => {
                                void setLevainPanelUiLevel(deviceId, tier === 'lab' ? 6 : 1);
                            }}
                        />
                    </fieldset>
                    <section aria-label="Selection detail" className="levain-window shrink-0 p-3">
                        <DawReadoutRow label="Selected instrument" value={instLabel} />
                        <DawReadoutRow label="Selected patch articulation" value={currentArt} />
                        <DawReadoutRow
                            label="Selected mic"
                            value={selectedMic?.name ?? (visibleMicCount === 0 ? 'No loaded mic' : 'No mic selected')}
                        />
                    </section>
                    {expert ? (
                        <>
                            <SectionCard
                                title="Phrase"
                                detail="Dynamics, vibrato, and legato belong together where the line is most visible."
                            >
                                <ExpressionPanel
                                    expression={patch.expression}
                                    legato={patch.legato}
                                    onChangeExp={(partial) =>
                                        setLevainParamWithAudio(deviceId, 'expression', {
                                            ...patch.expression,
                                            ...partial,
                                        })
                                    }
                                    onChangeLeg={(partial) =>
                                        setLevainParamWithAudio(deviceId, 'legato', { ...patch.legato, ...partial })
                                    }
                                />
                            </SectionCard>

                            <Grid cols={1} gap={3} className="shrink-0 @[540px]:grid-cols-2">
                                <SectionCard
                                    title="Lift"
                                    detail="Transition timing and portamento stay tactile instead of technical."
                                >
                                    <LegatoTuning
                                        config={patch.legato}
                                        onChange={(partial) =>
                                            setLevainParamWithAudio(deviceId, 'legato', { ...patch.legato, ...partial })
                                        }
                                    />
                                </SectionCard>

                                <SectionCard
                                    title="Spread"
                                    detail="Keep the ensemble alive without turning it into soup."
                                >
                                    <HumanizePanel
                                        config={patch.humanize}
                                        onChange={(partial) =>
                                            setLevainParamWithAudio(deviceId, 'humanize', {
                                                ...patch.humanize,
                                                ...partial,
                                            })
                                        }
                                    />
                                </SectionCard>
                            </Grid>

                            <SectionCard
                                title="Stage"
                                detail="Mic balance should feel spatial, not like raw mixer math."
                            >
                                <MicBlendSlider
                                    micPositions={visibleMicPositions}
                                    selectedMicIndex={selectedMicIndex}
                                    onSelectMic={(index) =>
                                        setMicSelection({
                                            deviceId,
                                            instrumentId: patch.instrumentId,
                                            bank: loadedMicPositions,
                                            index,
                                        })
                                    }
                                    showFull
                                    onSendMicParam={(micIndex, name, value) =>
                                        sendMicParamToEngine(deviceId, micIndex, name, value)
                                    }
                                    onUpdateMicPosition={(index, partial) =>
                                        updateMicPosition(deviceId, index, partial)
                                    }
                                />
                            </SectionCard>
                        </>
                    ) : null}
                </Stack>

                <Stack
                    as="aside"
                    aria-label="Performance controls"
                    tabIndex={0}
                    gap={3}
                    className="min-w-0 @[34rem]/levain:overflow-y-auto @[34rem]/levain:overscroll-contain @[34rem]/levain:pr-1"
                >
                    <SectionCard
                        title="Handles"
                        detail="Macros stay close by as performance gestures instead of generic plugin knobs."
                    >
                        <LevainMacroStrip
                            macros={patch.macros}
                            labels={patch.macroLabels}
                            onMacroChange={(macro, value) => setMacroWithAudio(deviceId, macro, value)}
                            spaceAvailable={loadedMicPositions?.includes('room') ?? false}
                            compact
                        />
                    </SectionCard>

                    {expert ? (
                        <>
                            <SectionCard title="Desk" detail="A couple of master moves for the final line.">
                                <Row justify="between" wrap gap={3}>
                                    <Stack align="center" gap={1}>
                                        <RotaryKnob
                                            key={deviceId}
                                            value={master.displayedValue}
                                            onChange={master.change}
                                            gestureAuthority={master.authority}
                                            paramId="masterGain"
                                            min={0}
                                            max={2}
                                            step={0.01}
                                            defaultValue={0.8}
                                            size="md"
                                            tone="amber"
                                            aria-label="Master"
                                        />
                                        <span className="text-micro uppercase tracking-[0.2em] text-muted-foreground/60">
                                            Master
                                        </span>
                                        <span className="font-mono text-caption text-foreground/85">
                                            {(master.displayedValue * 100).toFixed(0)}%
                                        </span>
                                    </Stack>

                                    <Stack gap={2}>
                                        <DawPluginChip
                                            active={patch.releaseTriggers.enabled}
                                            tone="amber"
                                            size="sm"
                                            onClick={() =>
                                                setLevainParamWithAudio(deviceId, 'releaseTriggers', {
                                                    ...patch.releaseTriggers,
                                                    enabled: !patch.releaseTriggers.enabled,
                                                })
                                            }
                                        >
                                            Release tails
                                        </DawPluginChip>
                                        <DawPluginChip
                                            active={patch.releaseTriggers.dynamicScale}
                                            tone="amber"
                                            size="sm"
                                            onClick={() =>
                                                setLevainParamWithAudio(deviceId, 'releaseTriggers', {
                                                    ...patch.releaseTriggers,
                                                    dynamicScale: !patch.releaseTriggers.dynamicScale,
                                                })
                                            }
                                        >
                                            Dynamic tails
                                        </DawPluginChip>
                                    </Stack>
                                </Row>
                            </SectionCard>

                            <SectionCard
                                title="Quick read"
                                detail="A compact performance summary for the current line."
                            >
                                <Stack gap={2}>
                                    <DawReadoutRow
                                        label="Instrument"
                                        value={instLabel}
                                        valueClassName="text-foreground/85"
                                    />
                                    <DawReadoutRow
                                        label="Family"
                                        value={patch.instrumentFamily}
                                        valueClassName="text-foreground/85"
                                    />
                                    <DawReadoutRow
                                        label="Phrase"
                                        value={currentArt}
                                        valueClassName="text-foreground/85"
                                    />
                                    <DawReadoutRow
                                        label="Humanize"
                                        value={`${Math.round(patch.humanize.amount * 100)}%`}
                                        valueClassName="text-foreground/85"
                                    />
                                    <DawReadoutRow
                                        label="Space"
                                        value={`${visibleMicCount} mic${visibleMicCount === 1 ? '' : 's'}`}
                                        valueClassName="text-foreground/85"
                                    />
                                </Stack>
                            </SectionCard>
                        </>
                    ) : null}
                </Stack>
            </div>
        </div>
    );
};
