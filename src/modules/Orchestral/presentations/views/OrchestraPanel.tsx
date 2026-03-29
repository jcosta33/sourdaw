/**
 * OrchestraPanel — orchestral instrument panel.
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

import { orchestralStore } from '../../stores/orchestralStore';
import { setMacroWithAudio } from '../../useCases/orchestralParamBridge';
import { loadInstrument } from '../../useCases/loadPreset';
import { type InstrumentId } from '../../models/OrchestraPatch';

import { OrchestraMacroStrip } from '../components/OrchestraMacroStrip';
import { ArticulationList } from '../components/ArticulationList';
import { ExpressionPanel } from '../components/ExpressionPanel';
import { LegatoTuning } from '../components/LegatoTuning';
import { HumanizePanel } from '../components/HumanizePanel';
import { MicBlendSlider } from '../components/MicBlendSlider';

// ── Instruments ─────────────────────────────────────────────────────

// Only show instruments that have sample content available.
// Currently only solo violin is sampled (VSCO-2-CE).
// Other instruments will be added as sample content is acquired.
const INSTRUMENTS: { id: InstrumentId; label: string; hasSamples: boolean }[] = [
    { id: 'violin-1', label: 'Solo Violin', hasSamples: true },
    { id: 'violin-2', label: 'Violins II', hasSamples: false },
    { id: 'viola', label: 'Violas', hasSamples: false },
    { id: 'cello', label: 'Cellos', hasSamples: false },
    { id: 'double-bass', label: 'Basses', hasSamples: false },
    { id: 'trumpet', label: 'Trumpets', hasSamples: false },
    { id: 'horn', label: 'Horns', hasSamples: false },
    { id: 'trombone', label: 'Trombones', hasSamples: false },
    { id: 'flute', label: 'Flutes', hasSamples: false },
    { id: 'oboe', label: 'Oboes', hasSamples: false },
    { id: 'clarinet', label: 'Clarinets', hasSamples: false },
    { id: 'bassoon', label: 'Bassoons', hasSamples: false },
    { id: 'timpani', label: 'Timpani', hasSamples: false },
    { id: 'harp', label: 'Harp', hasSamples: false },
];

// ═════════════════════════════════════════════════════════════════════

export const OrchestraPanel = (): ReactElement => {
    const state = useSyncExternalStore(
        (cb) => orchestralStore.subscribe(cb),
        () => orchestralStore.value,
    );
    const patch = state?.patch ?? orchestralStore.value?.patch;
    const activeVoices = state?.activeVoices ?? 0;
    const currentArt = state?.currentArticulationDisplay ?? 'Long';

    const [instOpen, setInstOpen] = useState(false);

    if (!patch) {
        return <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Loading…</div>;
    }

    const instLabel = INSTRUMENTS.find((i) => i.id === patch.instrumentId)?.label ?? patch.instrumentId;

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar ─── */}
            <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b border-border/30 bg-surface-app/30">
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
                                <div className="absolute top-full left-0 mt-1 z-50 bg-surface-raised border border-border/40 rounded-md shadow-xl py-1 min-w-[140px] max-h-[280px] overflow-y-auto">
                                    {INSTRUMENTS.filter((i) => i.hasSamples).map((inst) => (
                                        <button
                                            key={inst.id}
                                            type="button"
                                            className={`w-full text-left px-3 py-1 text-[10px] transition-colors ${
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

                        {/* Expression group — with canvas visualization */}
                        <div className="shrink-0 px-2">
                            <ExpressionPanel expression={patch.expression} legato={patch.legato} />
                        </div>

                        <div className="w-px self-stretch bg-border/15 shrink-0" />

                        {/* Legato group — with canvas visualization */}
                        <div className="shrink-0 px-2">
                            <LegatoTuning config={patch.legato} />
                        </div>

                        <div className="w-px self-stretch bg-border/15 shrink-0" />

                        {/* Humanize group — XL knob + detail knobs */}
                        <div className="shrink-0 px-2">
                            <HumanizePanel config={patch.humanize} />
                        </div>

                        <div className="w-px self-stretch bg-border/15 shrink-0" />

                        {/* Mic group — blend knob or full faders */}
                        <div className="shrink-0 px-2">
                            <MicBlendSlider
                                micPositions={patch.micPositions}
                                showFull={patch.micPositions.length > 1}
                            />
                        </div>
                    </div>
                </div>

                {/* RIGHT: Macro knobs — always visible */}
                <div className="w-[130px] shrink-0 border-l border-border/20 p-2 overflow-y-auto">
                    <OrchestraMacroStrip
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
