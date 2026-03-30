/**
 * LevainPanel — levain instrument panel.
 *
 * Single screen, horizontal layout for wide bottom panels.
 * All controls visible at once — no tabs, no levels.
 *
 *   ┌──────────┬──────────────────────────────────────────────┬──────────┐
 *   │ Artics   │ Expression │ Legato │ Humanize │ Mics        │ Macros   │
 *   │ sidebar  │ curve+knobs│ dia+kb │  XL+det  │ blend       │ 4×2 grid │
 *   └──────────┴──────────────────────────────────────────────┴──────────┘
 */
import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { Cpu, ChevronDown } from 'lucide-react';

import { levainStore } from '../../stores/levainStore';
import { setMacroWithAudio, sendMicParamToEngine } from '../../useCases/levainParamBridge';
import { loadInstrument } from '../../useCases/loadPreset';
import { type InstrumentId } from '../../models/LevainPatch';

import { LevainMacroStrip } from '../components/LevainMacroStrip';
import { ArticulationList } from '../components/ArticulationList';
import { ExpressionPanel } from '../components/ExpressionPanel';
import { LegatoTuning } from '../components/LegatoTuning';
import { HumanizePanel } from '../components/HumanizePanel';
import { setLevainParamWithAudio } from '../../useCases/levainParamBridge';
import { MicBlendSlider } from '../components/MicBlendSlider';

// ── Instruments ─────────────────────────────────────────────────────

// All instruments with VSCO-2-CE sample content (CC0 — public domain).
// Harp remains disabled until a suitable CC0 harp library is sourced.
const INSTRUMENTS: { id: InstrumentId; label: string; hasSamples: boolean; family: string }[] = [
    // Strings
    { id: 'violin-1', label: 'Solo Violin', hasSamples: true, family: 'Strings' },
    { id: 'violin-2', label: 'Violins II', hasSamples: true, family: 'Strings' },
    { id: 'viola', label: 'Violas', hasSamples: true, family: 'Strings' },
    { id: 'cello', label: 'Cellos', hasSamples: true, family: 'Strings' },
    { id: 'double-bass', label: 'Basses', hasSamples: true, family: 'Strings' },
    // Brass
    { id: 'trumpet', label: 'Trumpets', hasSamples: true, family: 'Brass' },
    { id: 'horn', label: 'Horns', hasSamples: true, family: 'Brass' },
    { id: 'trombone', label: 'Trombones', hasSamples: true, family: 'Brass' },
    { id: 'tuba', label: 'Tuba', hasSamples: true, family: 'Brass' },
    // Woodwinds
    { id: 'flute', label: 'Flutes', hasSamples: true, family: 'Woodwinds' },
    { id: 'piccolo', label: 'Piccolo', hasSamples: true, family: 'Woodwinds' },
    { id: 'oboe', label: 'Oboes', hasSamples: true, family: 'Woodwinds' },
    { id: 'clarinet', label: 'Clarinets', hasSamples: true, family: 'Woodwinds' },
    { id: 'bassoon', label: 'Bassoons', hasSamples: true, family: 'Woodwinds' },
    // Percussion & Keys
    { id: 'timpani', label: 'Timpani', hasSamples: true, family: 'Percussion' },
    { id: 'glockenspiel', label: 'Glockenspiel', hasSamples: true, family: 'Percussion' },
    { id: 'marimba', label: 'Marimba', hasSamples: true, family: 'Percussion' },
    // Not yet sourced
    { id: 'harp', label: 'Harp', hasSamples: false, family: 'Strings' },
];

// ═════════════════════════════════════════════════════════════════════

export const LevainPanel = (): ReactElement => {
    const state = useSyncExternalStore(
        (cb) => levainStore.subscribe(cb),
        () => levainStore.value,
    );
    const patch = state?.patch ?? levainStore.value?.patch;
    const activeVoices = state?.activeVoices ?? 0;
    const currentArt = state?.currentArticulationDisplay ?? 'Long';

    const [instOpen, setInstOpen] = useState(false);

    if (!patch) {
        return <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs italic">Warming up the starter...</div>;
    }

    const instLabel = INSTRUMENTS.find((i) => i.id === patch.instrumentId)?.label ?? patch.instrumentId;

    return (
        <div className="flex flex-col h-full relative">
            {/* ─── Top bar ─── */}
            <div
                className="flex items-center justify-between px-3 py-1 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, rgba(20,20,22,0.95) 0%, rgba(14,14,16,0.95) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                }}
            >
                <div className="flex items-center gap-2">
                    {/* Instrument dropdown */}
                    <div className="relative">
                        <button
                            type="button"
                            className="flex items-center gap-1 text-[10px] font-bold text-[var(--color-accent-amber)] tracking-tight hover:text-[var(--color-accent-orange)] transition-colors"
                            onClick={() => setInstOpen(!instOpen)}
                        >
                            {instLabel}
                            <ChevronDown className="size-3 opacity-50" />
                        </button>
                        {instOpen ? (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setInstOpen(false)} />
                                <div className="absolute top-full left-0 mt-1 z-50 bg-surface-raised border border-border/40 rounded-md shadow-xl py-1 min-w-[160px] max-h-[320px] overflow-y-auto">
                                    {(['Strings', 'Brass', 'Woodwinds', 'Percussion'] as const).map((family) => {
                                        const familyInstruments = INSTRUMENTS.filter((i) => i.family === family && i.hasSamples);
                                        if (familyInstruments.length === 0) return null;
                                        return (
                                            <div key={family}>
                                                <div className="px-3 pt-2 pb-0.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">
                                                    {family}
                                                </div>
                                                {familyInstruments.map((inst) => (
                                                    <button
                                                        key={inst.id}
                                                        type="button"
                                                        className={`w-full text-left px-4 py-1 text-[10px] transition-colors ${
                                                            patch.instrumentId === inst.id
                                                                ? 'text-[var(--color-accent-amber)] bg-[var(--color-accent-amber)]/10'
                                                                : 'text-foreground/80 hover:bg-surface-raised hover:text-foreground'
                                                        }`}
                                                        onClick={() => { loadInstrument(inst.id); setInstOpen(false); }}
                                                    >
                                                        {inst.label}
                                                    </button>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        ) : null}
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-[var(--color-accent-amber)]/15 text-[var(--color-accent-amber)]">
                        {currentArt}
                    </span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    <Cpu className="size-3" />
                    <span>{activeVoices}v</span>
                </div>
            </div>

            {/* ─── Body: horizontal layout, all controls visible ─── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* LEFT: Articulations — always visible */}
                <div className="w-[130px] shrink-0 border-r border-border/20 overflow-y-auto">
                    <ArticulationList
                        articulations={patch.articulations}
                        current={patch.currentArticulation}
                    />
                </div>

                {/* CENTER: control groups laid out horizontally */}
                <div className="flex-1 min-w-0 overflow-x-auto overflow-y-auto">
                    <div className="flex items-start gap-0 p-2 h-full min-w-max">

                        {/* Expression group */}
                        <div className="shrink-0 px-2">
                            <ExpressionPanel 
                                expression={patch.expression} 
                                legato={patch.legato} 
                                onChangeExp={(p) => setLevainParamWithAudio('expression', { ...patch.expression, ...p })}
                                onChangeLeg={(p) => setLevainParamWithAudio('legato', { ...patch.legato, ...p })}
                            />
                        </div>

                        <div className="w-px self-stretch bg-border/15 shrink-0" />

                        {/* Legato group */}
                        <div className="shrink-0 px-2">
                            <LegatoTuning 
                                config={patch.legato} 
                                onChange={(p) => setLevainParamWithAudio('legato', { ...patch.legato, ...p })}
                            />
                        </div>

                        <div className="w-px self-stretch bg-border/15 shrink-0" />

                        {/* Humanize group */}
                        <div className="shrink-0 px-2">
                            <HumanizePanel 
                                config={patch.humanize} 
                                onChange={(p) => setLevainParamWithAudio('humanize', { ...patch.humanize, ...p })}
                            />
                        </div>

                        <div className="w-px self-stretch bg-border/15 shrink-0" />

                        {/* Mic group — blend knob or full faders */}
                        <div className="shrink-0 px-2">
                            <MicBlendSlider
                                micPositions={patch.micPositions}
                                showFull={patch.micPositions.length > 1}
                                onSendMicParam={sendMicParamToEngine}
                            />
                        </div>
                    </div>
                </div>

                {/* RIGHT: Macro knobs — always visible */}
                <div className="w-[130px] shrink-0 border-l border-border/20 p-2 overflow-y-auto">
                    <LevainMacroStrip
                        macros={patch.macros}
                        labels={patch.macroLabels}
                        onMacroChange={setMacroWithAudio}
                        compact
                    />
                </div>
            </div>
        </div>
    );
};
