import { type ReactElement, useState } from 'react';

import { Search } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { useStore } from '#/infra/store/useStore';

import { type InstrumentId } from '../../models/LevainPatch';
import { defaultLevainState, levainStore, updateMicPosition } from '../../stores/levainStore';
import { sendMicParamToEngine } from '../../useCases/levainParamBridge/sendMicParamToEngine';
import { setLevainParamWithAudio } from '../../useCases/levainParamBridge/setLevainParamWithAudio';
import { setMacroWithAudio } from '../../useCases/levainParamBridge/setMacroWithAudio';
import { loadInstrument } from '../../useCases/loadPreset';
import { ArticulationList } from '../components/ArticulationList';
import { ExpressionPanel } from '../components/ExpressionPanel';
import { HumanizePanel } from '../components/HumanizePanel';
import { LegatoTuning } from '../components/LegatoTuning';
import { LevainMacroStrip } from '../components/LevainMacroStrip';
import { MicBlendSlider } from '../components/MicBlendSlider';

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
        className="levain-window"
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

    const { patch, currentArticulationDisplay: currentArt, engineReady, sampleLoadProgress } = state;
    const sampleLoadError = state.sampleLoadError ?? null;

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
        <div className="levain-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_16rem] gap-3">
                <aside className="flex min-h-0 flex-col gap-3">
                    <section className="levain-window flex min-h-0 flex-col gap-3 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                                <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-amber)]/70">
                                    Lineup
                                </div>
                                <div className="text-[15px] font-semibold text-foreground">Levain</div>
                            </div>
                            <DawPluginLed
                                tone="amber"
                                role="status"
                                aria-live="polite"
                                aria-label={engineReady ? 'Engine ready' : 'Engine loading'}
                            >
                                {engineReady ? 'Ready' : 'Loading'}
                            </DawPluginLed>
                        </div>

                        <label className="levain-window flex items-center gap-2 px-3 py-2">
                            <Search className="size-3.5 text-muted-foreground/55" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Find a section"
                                className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/45"
                                aria-label="Search Levain instruments"
                            />
                        </label>

                        <div
                            className="flex flex-wrap gap-1.5"
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
                                        size="sm"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setFamily(entry)}
                                    >
                                        {entry}
                                    </DawPluginChip>
                                );
                            })}
                        </div>

                        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                            {visibleInstruments.map((instrument) => {
                                const active = patch.instrumentId === instrument.id;
                                return (
                                    <button
                                        key={instrument.id}
                                        type="button"
                                        aria-pressed={active}
                                        aria-current={active ? 'true' : undefined}
                                        className={`levain-window flex flex-col items-start gap-1 px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-white/18 bg-white/[0.03]'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                        onClick={() => loadInstrument(deviceId, instrument.id)}
                                    >
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-foreground">
                                                {instrument.label}
                                            </span>
                                            <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/45">
                                                {instrument.family}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="levain-window min-h-0 overflow-y-auto p-2">
                        <div className="px-2 pb-2 text-[8px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]/70">
                            Articulation rail
                        </div>
                        <ArticulationList
                            articulations={patch.articulations}
                            current={patch.currentArticulation}
                            onSelect={(type) => setLevainParamWithAudio(deviceId, 'currentArticulation', type)}
                        />
                    </section>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-amber)]/70">
                                Phrase stage
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{instLabel}</div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                            <DawPluginMetricTile
                                className="levain-window"
                                label="Artic"
                                value={currentArt}
                                detail="Current technique"
                            />
                            <DawPluginMetricTile
                                className="levain-window"
                                label="Legato"
                                value={patch.legato.enabled ? 'On' : 'Off'}
                                detail="Transition engine"
                            />
                            <DawPluginMetricTile
                                className="levain-window"
                                label="Load"
                                role="status"
                                aria-live="polite"
                                value={loadValue}
                                valueClassName={
                                    sampleLoadError !== null ? 'text-[var(--color-state-danger)]' : undefined
                                }
                                detail={sampleLoadError !== null ? sampleLoadError : 'Sample stream'}
                            />
                        </div>
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_18rem] gap-3">
                        <div className="flex min-h-0 flex-col gap-3">
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

                            <div className="grid grid-cols-2 gap-3">
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
                            </div>
                        </div>

                        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                            <SectionCard
                                title="Stage"
                                detail="Mic balance should feel spatial, not like raw mixer math."
                            >
                                <MicBlendSlider
                                    micPositions={patch.micPositions}
                                    showFull
                                    onSendMicParam={(micIndex, name, value) =>
                                        sendMicParamToEngine(deviceId, micIndex, name, value)
                                    }
                                    onUpdateMicPosition={(index, partial) =>
                                        updateMicPosition(deviceId, index, partial)
                                    }
                                />
                            </SectionCard>

                            <SectionCard
                                title="Handles"
                                detail="Macros stay close by as performance gestures instead of generic plugin knobs."
                            >
                                <LevainMacroStrip
                                    macros={patch.macros}
                                    labels={patch.macroLabels}
                                    onMacroChange={(macro, value) => setMacroWithAudio(deviceId, macro, value)}
                                    compact
                                />
                            </SectionCard>

                            <SectionCard title="Desk" detail="A couple of master moves for the final line.">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex flex-col items-center gap-1">
                                        <RotaryKnob
                                            value={patch.masterGain}
                                            onChange={(value) => setLevainParamWithAudio(deviceId, 'masterGain', value)}
                                            min={0}
                                            max={2}
                                            step={0.01}
                                            defaultValue={0.8}
                                            size="md"
                                            tone="amber"
                                            aria-label="Master"
                                        />
                                        <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
                                            Master
                                        </span>
                                        <span className="font-mono text-[9px] text-foreground/85">
                                            {(patch.masterGain * 100).toFixed(0)}%
                                        </span>
                                    </div>

                                    <div className="space-y-2">
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
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Quick read" detail="A compact performance summary for the current line.">
                        <div className="space-y-2">
                            <DawReadoutRow label="Instrument" value={instLabel} valueClassName="text-foreground/85" />
                            <DawReadoutRow
                                label="Family"
                                value={patch.instrumentFamily}
                                valueClassName="text-foreground/85"
                            />
                            <DawReadoutRow label="Phrase" value={currentArt} valueClassName="text-foreground/85" />
                            <DawReadoutRow
                                label="Humanize"
                                value={`${Math.round(patch.humanize.amount * 100)}%`}
                                valueClassName="text-foreground/85"
                            />
                            <DawReadoutRow
                                label="Space"
                                value={`${patch.micPositions.length} mics`}
                                valueClassName="text-foreground/85"
                            />
                        </div>
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
