import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react';
import { Cpu, Power } from 'lucide-react';
import { APP_EVENTS } from '#/helpers/Event/appEvents';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import {
    grandBouleStore,
    type GrandBouleState,
    type TemperamentIndex,
} from '../../stores/grandBouleStore';
import { listGrandBoulePresets } from '../../useCases/listGrandBoulePresets';
import { loadGrandBoulePreset } from '../../useCases/loadGrandBoulePreset';
import { panicGrandBoule } from '../../useCases/panicGrandBoule';
import { releaseGrandBouleNote } from '../../useCases/releaseGrandBouleNote';
import {
    resolveGrandBouleEngine,
    type ResolvedGrandBouleEngine,
} from '../../useCases/resolveGrandBouleEngine';
import { setGrandBouleMasterGain } from '../../useCases/setGrandBouleMasterGain';
import { setGrandBouleSostenuto } from '../../useCases/setGrandBouleSostenuto';
import { setGrandBouleSoundboardSend } from '../../useCases/setGrandBouleSoundboardSend';
import { setGrandBouleSustain } from '../../useCases/setGrandBouleSustain';
import { setGrandBouleSympatheticSend } from '../../useCases/setGrandBouleSympatheticSend';
import { setGrandBouleTemperament } from '../../useCases/setGrandBouleTemperament';
import { setGrandBouleUnaCorda } from '../../useCases/setGrandBouleUnaCorda';
import { setGrandBouleVelocityCurve } from '../../useCases/setGrandBouleVelocityCurve';
import { setGrandBouleMorphPosition } from '../../useCases/setGrandBouleMorphPosition';
import {
    setGrandBoulePerNoteParam,
    resetGrandBoulePerNoteParams,
} from '../../useCases/setGrandBoulePerNoteParam';
import { triggerGrandBouleNote } from '../../useCases/triggerGrandBouleNote';
import {
    setVelocityCurveExponent,
    setVelocityFloor,
    setVelocityCeiling,
    setCcSmoothingMs,
    setSustainThreshold,
    setAfterTouchSensitivity,
    resetMidiCalibration,
} from '../../useCases/calibrateGrandBouleMidi';
import { MidiCalibrationPanel } from '../components/MidiCalibrationPanel';
import { MorphPanel } from '../components/MorphPanel';
import { PerNoteEditor } from '../components/PerNoteEditor';
import { PianoModel3D } from '../components/PianoModel3D';
import { SpectralWaterfall } from '../components/SpectralWaterfall';
import { StringVibrationView } from '../components/StringVibrationView';

/**
 * Grand Boule piano plugin panel view (§8).
 *
 * Composes the interactive keyboard, the string-vibration visualiser, the
 * spectral waterfall, and the global/pedal controls. Subscribes to the
 * Grand Boule store and dispatches every user input through a use case.
 */

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
        className="grand-boule-window"
        title={title}
        detail={detail}
        titleClassName="text-neutral-400/80"
    >
        {children}
    </DawPluginSectionCard>
);

const Knob = ({
    value,
    label,
    min,
    max,
    step,
    defaultValue,
    onChange,
    readout,
}: {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (value: number) => void;
    readout: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
                {label}
            </div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </div>
);

const TEMPERAMENT_OPTIONS = [
    { value: 0 as TemperamentIndex, label: 'Equal' },
    { value: 1 as TemperamentIndex, label: 'Werckmeister III' },
    { value: 2 as TemperamentIndex, label: 'Kirnberger III' },
    { value: 3 as TemperamentIndex, label: 'Vallotti' },
    { value: 4 as TemperamentIndex, label: 'Young II' },
    { value: 5 as TemperamentIndex, label: 'Meantone ¼' },
] as const;

export const GrandBoulePanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const engine: ResolvedGrandBouleEngine = resolveGrandBouleEngine({ deviceId });
    const state = useSyncExternalStore<GrandBouleState | null>(
        (callback) => grandBouleStore.subscribe(callback),
        () => grandBouleStore.value,
    );
    const [activeNotes, setActiveNotes] = useState<ReadonlyMap<number, number>>(
        () => new Map(),
    );
    const [lidPosition, setLidPosition] = useState(1.0);
    const [lastVelocity, setLastVelocity] = useState(0);

    // Subscribe to external MIDI note events so the visual keyboard reflects
    // notes played on a physical controller (e.g. Akai).
    useEffect(() => {
        const onMidiNoteOn = (e: Event): void => {
            const { midiNote, velocity } = (e as CustomEvent).detail;
            setLastVelocity(Math.round(velocity * 127));
            setActiveNotes((prev) => {
                const next = new Map(prev);
                next.set(midiNote as number, velocity as number);
                return next;
            });
        };
        const onMidiNoteOff = (e: Event): void => {
            const { midiNote } = (e as CustomEvent).detail;
            setActiveNotes((prev) => {
                if (!prev.has(midiNote as number)) {
                    return prev;
                }
                const next = new Map(prev);
                next.delete(midiNote as number);
                return next;
            });
        };
        const onMidiPedalCC = (e: Event): void => {
            const { cc, value } = (e as CustomEvent).detail;
            const s = grandBouleStore.value;
            if (s === null) return;
            if (cc === 64) {
                grandBouleStore.set({ ...s, pedals: { ...s.pedals, sustain: value as number } });
            } else if (cc === 66) {
                grandBouleStore.set({ ...s, pedals: { ...s.pedals, sostenuto: value as boolean } });
            } else if (cc === 67) {
                grandBouleStore.set({ ...s, pedals: { ...s.pedals, unaCorda: value as boolean } });
            }
        };
        document.addEventListener(APP_EVENTS.MIDI_NOTE_ON, onMidiNoteOn);
        document.addEventListener(APP_EVENTS.MIDI_NOTE_OFF, onMidiNoteOff);
        document.addEventListener(APP_EVENTS.MIDI_PEDAL_CC, onMidiPedalCC);
        return () => {
            document.removeEventListener(APP_EVENTS.MIDI_NOTE_ON, onMidiNoteOn);
            document.removeEventListener(APP_EVENTS.MIDI_NOTE_OFF, onMidiNoteOff);
            document.removeEventListener(APP_EVENTS.MIDI_PEDAL_CC, onMidiPedalCC);
        };
    }, []);

    // On mount (or when the engine becomes available), dispatch the active
    // piano model's parameters so the DSP matches the UI from the start.
    const engineReady = engine.isReady();
    useEffect(() => {
        if (!engineReady) {
            return;
        }
        setGrandBouleMorphPosition({ engine, morphPosition: 0 });
    }, [engineReady]);

    // Read FFT data from the track's AnalyserNode for the spectral waterfall.
    const [fftFrame, setFftFrame] = useState<Float32Array | null>(null);
    useEffect(() => {
        if (!engineReady) {
            return;
        }
        const analyser = engine.getAnalyserNode();
        if (analyser === null) {
            return;
        }
        analyser.fftSize = 512;
        const binCount = analyser.frequencyBinCount; // 256
        const dbBuffer = new Float32Array(binCount);
        const normBuffer = new Float32Array(binCount);
        let raf = 0;
        const read = (): void => {
            analyser.getFloatFrequencyData(dbBuffer);
            // Convert dB (-100..0) to normalised 0..1 magnitudes.
            for (let i = 0; i < binCount; i += 1) {
                normBuffer[i] = Math.max(0, Math.min(1, (dbBuffer[i]! + 100) / 100));
            }
            setFftFrame(new Float32Array(normBuffer));
            raf = requestAnimationFrame(read);
        };
        raf = requestAnimationFrame(read);
        return () => cancelAnimationFrame(raf);
    }, [engineReady]);

    const liveState = state ?? grandBouleStore.value;
    if (liveState === null) {
        return <div className="h-full" />;
    }

    const { config, parameters, pedals, morph, temperament, activeVoices } = liveState;
    const presets = listGrandBoulePresets();

    const handleNoteOn = (midiNote: number, velocity: number): void => {
        triggerGrandBouleNote({ engine, midiNote, velocity });
        setLastVelocity(Math.round(velocity * 127));
        setActiveNotes((prev) => {
            const next = new Map(prev);
            next.set(midiNote, velocity);
            return next;
        });
    };

    const handleNoteOff = (midiNote: number): void => {
        releaseGrandBouleNote({ engine, midiNote });
        setActiveNotes((prev) => {
            if (!prev.has(midiNote)) {
                return prev;
            }
            const next = new Map(prev);
            next.delete(midiNote);
            return next;
        });
    };

    return (
        <div className="grand-boule-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)_16rem] gap-3">
                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Preset shelf" detail="Signature Grand Boule voicings.">
                        <div className="flex flex-col gap-1">
                            {presets.map((preset) => {
                                const active = config.activePresetId === preset.id;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() =>
                                            loadGrandBoulePreset({ engine, presetId: preset.id })
                                        }
                                        className={`grand-boule-window flex flex-col items-start gap-1 px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-neutral-400/40 bg-neutral-300/10'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                    >
                                        <span className="text-[11px] font-medium text-foreground">
                                            {preset.name}
                                        </span>
                                        <span className="text-[9px] leading-tight text-muted-foreground">
                                            {preset.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </SectionCard>

                    <SectionCard title="Morph" detail="Piano model blending (§3.1).">
                        <MorphPanel
                            morph={morph}
                            onMorphPositionChange={(position) =>
                                setGrandBouleMorphPosition({ engine, morphPosition: position })
                            }
                            onLayerBalanceChange={(balance) => {
                                const s = grandBouleStore.value;
                                if (s !== null) {
                                    grandBouleStore.set({ ...s, morph: { ...s.morph, layerBalance: balance } });
                                }
                            }}
                            onModelAChange={(modelId) => {
                                const s = grandBouleStore.value;
                                if (s !== null) {
                                    grandBouleStore.set({ ...s, morph: { ...s.morph, modelA: modelId } });
                                    setGrandBouleMorphPosition({ engine, morphPosition: s.morph.morphPosition });
                                }
                            }}
                            onModelBChange={(modelId) => {
                                const s = grandBouleStore.value;
                                if (s !== null) {
                                    grandBouleStore.set({ ...s, morph: { ...s.morph, modelB: modelId } });
                                    setGrandBouleMorphPosition({ engine, morphPosition: s.morph.morphPosition });
                                }
                            }}
                            onEnabledChange={(enabled) => {
                                const s = grandBouleStore.value;
                                if (s !== null) {
                                    grandBouleStore.set({ ...s, morph: { ...s.morph, enabled } });
                                }
                            }}
                        />
                    </SectionCard>

                    <SectionCard title="Mix" detail="Master, soundboard, sympathetic.">
                        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                            <Knob
                                value={config.masterGain}
                                onChange={(value) =>
                                    setGrandBouleMasterGain({ engine, gain: value })
                                }
                                label="Master"
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={0.7}
                                readout={`${Math.round(config.masterGain * 100)}%`}
                            />
                            <Knob
                                value={config.soundboardSend}
                                onChange={(value) =>
                                    setGrandBouleSoundboardSend({ engine, amount: value })
                                }
                                label="Board"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.6}
                                readout={`${Math.round(config.soundboardSend * 100)}%`}
                            />
                            <Knob
                                value={config.sympatheticSend}
                                onChange={(value) =>
                                    setGrandBouleSympatheticSend({ engine, amount: value })
                                }
                                label="Symp"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.25}
                                readout={`${Math.round(config.sympatheticSend * 100)}%`}
                            />
                        </div>
                    </SectionCard>
                    <SectionCard title="Per-Note" detail="Key-specific parameter editing (§3.1).">
                        <PerNoteEditor
                            perNoteOverrides={liveState.perNoteOverrides}
                            onParamChange={(key, param, value) =>
                                setGrandBoulePerNoteParam({
                                    engine,
                                    key,
                                    param,
                                    value,
                                    perNoteMap: liveState.perNoteOverrides,
                                    setPerNoteMap: (next) => {
                                        const s = grandBouleStore.value;
                                        if (s !== null) {
                                            grandBouleStore.set({ ...s, perNoteOverrides: next });
                                        }
                                    },
                                })
                            }
                            onReset={(key) =>
                                resetGrandBoulePerNoteParams({
                                    engine,
                                    key,
                                    perNoteMap: liveState.perNoteOverrides,
                                    setPerNoteMap: (next) => {
                                        const s = grandBouleStore.value;
                                        if (s !== null) {
                                            grandBouleStore.set({ ...s, perNoteOverrides: next });
                                        }
                                    },
                                })
                            }
                        />
                    </SectionCard>

                    <SectionCard title="MIDI Calibration" detail="Controller tuning (§3.1).">
                        <MidiCalibrationPanel
                            calibration={liveState.midiCalibration}
                            lastVelocity={lastVelocity}
                            onVelocityCurveExponentChange={setVelocityCurveExponent}
                            onVelocityFloorChange={setVelocityFloor}
                            onVelocityCeilingChange={setVelocityCeiling}
                            onCcSmoothingMsChange={setCcSmoothingMs}
                            onSustainThresholdChange={setSustainThreshold}
                            onAfterTouchSensitivityChange={setAfterTouchSensitivity}
                            onReset={resetMidiCalibration}
                        />
                    </SectionCard>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-neutral-400/80">
                                Grand Boule
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">
                                Physical Modeling Piano
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                            <DawPluginMetricTile
                                className="grand-boule-window min-w-[94px]"
                                label="Voices"
                                value={`${activeVoices}`}
                                detail="Active"
                            />
                            <DawPluginMetricTile
                                className="grand-boule-window min-w-[94px]"
                                label="Engine"
                                value={engine.isReady() ? 'ready' : 'idle'}
                                detail="WASM"
                            />
                        </div>
                    </div>

                    <div className="grand-boule-window min-h-0 shrink-0 overflow-hidden p-2" style={{ height: 280 }}>
                        <PianoModel3D
                            activeNotes={activeNotes}
                            sustainPedal={pedals.sustain}
                            unaCorda={pedals.unaCorda}
                            sostenuto={pedals.sostenuto}
                            lidPosition={lidPosition}
                            onNoteOn={handleNoteOn}
                            onNoteOff={handleNoteOff}
                            className="h-full w-full"
                        />
                    </div>

                    <div className="grand-boule-window min-h-0 flex-1 overflow-hidden p-2">
                        <StringVibrationView
                            activeNotes={activeNotes}
                            className="h-full w-full"
                        />
                    </div>

                    <div className="grand-boule-window min-h-0 shrink-0 overflow-hidden p-2" style={{ height: 160 }}>
                        <SpectralWaterfall
                            fftFrame={fftFrame}
                            className="h-full w-full"
                        />
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Pedals" detail="Sustain, una corda, sostenuto.">
                        <div className="flex flex-col gap-3">
                            <Knob
                                value={pedals.sustain}
                                onChange={(value) =>
                                    setGrandBouleSustain({ engine, position: value })
                                }
                                label="Sustain"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                readout={`${Math.round(pedals.sustain * 100)}%`}
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
                                    Una corda
                                </span>
                                <DawPluginToggle
                                    pressed={pedals.unaCorda}
                                    tone="neutral"
                                    onClick={() =>
                                        setGrandBouleUnaCorda({
                                            engine,
                                            engaged: !pedals.unaCorda,
                                        })
                                    }
                                />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
                                    Sostenuto
                                </span>
                                <DawPluginToggle
                                    pressed={pedals.sostenuto}
                                    tone="neutral"
                                    onClick={() =>
                                        setGrandBouleSostenuto({
                                            engine,
                                            engaged: !pedals.sostenuto,
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard title="Tuning" detail="Historical temperament (§4).">
                        <div className="flex flex-col gap-1">
                            {TEMPERAMENT_OPTIONS.map((option) => {
                                const active = temperament === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() =>
                                            setGrandBouleTemperament({
                                                deviceId,
                                                temperament: option.value,
                                            })
                                        }
                                        className={`rounded-sm px-2 py-1 text-left text-[10px] transition-colors ${
                                            active
                                                ? 'bg-neutral-300/15 text-neutral-200 font-medium'
                                                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                                        }`}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </SectionCard>

                    <SectionCard title="Touch" detail="Velocity curve shaping.">
                        <Knob
                            value={parameters.velocityCurve}
                            onChange={(value) =>
                                setGrandBouleVelocityCurve({ engine, exponent: value })
                            }
                            label="Curve"
                            min={0.5}
                            max={2}
                            step={0.05}
                            defaultValue={1.0}
                            readout={
                                parameters.velocityCurve < 0.95
                                    ? 'soft'
                                    : parameters.velocityCurve > 1.05
                                      ? 'hard'
                                      : 'linear'
                            }
                        />
                    </SectionCard>

                    <SectionCard title="Transport" detail="Panic and voice status.">
                        <div className="flex items-center gap-2">
                            <DawPluginChip
                                tone="danger"
                                size="sm"
                                onClick={() => {
                                    panicGrandBoule({ engine });
                                    setActiveNotes(new Map());
                                }}
                            >
                                <Power className="size-3.5" />
                                Panic
                            </DawPluginChip>
                            <DawPluginLed tone="neutral" className="flex items-center gap-1">
                                <Cpu className="size-3" />
                                {activeVoices} voices
                            </DawPluginLed>
                        </div>
                    </SectionCard>

                    <SectionCard title="Lid" detail="Grand piano lid position.">
                        <Knob
                            value={lidPosition}
                            onChange={setLidPosition}
                            label="Position"
                            min={0}
                            max={1}
                            step={0.01}
                            defaultValue={1.0}
                            readout={
                                lidPosition < 0.3
                                    ? 'closed'
                                    : lidPosition < 0.7
                                      ? 'half'
                                      : 'full'
                            }
                        />
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
