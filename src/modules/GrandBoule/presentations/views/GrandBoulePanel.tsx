import { type ReactElement, useEffect, useState, useMemo } from 'react';

import { Cpu, Power } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { defaultGrandBouleState, createGrandBouleStore, type TemperamentIndex } from '../../stores/grandBouleStore';
import { resetMidiCalibration } from '../../useCases/calibrateGrandBouleMidi/resetMidiCalibration';
import { setAfterTouchSensitivity } from '../../useCases/calibrateGrandBouleMidi/setAfterTouchSensitivity';
import { setCcSmoothingMs } from '../../useCases/calibrateGrandBouleMidi/setCcSmoothingMs';
import { setSustainThreshold } from '../../useCases/calibrateGrandBouleMidi/setSustainThreshold';
import { setVelocityCeiling } from '../../useCases/calibrateGrandBouleMidi/setVelocityCeiling';
import { setVelocityCurveExponent } from '../../useCases/calibrateGrandBouleMidi/setVelocityCurveExponent';
import { setVelocityFloor } from '../../useCases/calibrateGrandBouleMidi/setVelocityFloor';
import { listGrandBoulePresets } from '../../useCases/listGrandBoulePresets';
import { loadGrandBoulePreset } from '../../useCases/loadGrandBoulePreset';
import { onMidiNoteOff } from '../../useCases/midiEventSubscribers/onMidiNoteOff';
import { onMidiNoteOn } from '../../useCases/midiEventSubscribers/onMidiNoteOn';
import { onMidiPedalCc } from '../../useCases/midiEventSubscribers/onMidiPedalCc';
import { panicGrandBoule } from '../../useCases/panicGrandBoule';
import { releaseGrandBouleNote } from '../../useCases/releaseGrandBouleNote';
import { resolveGrandBouleEngine, type ResolvedGrandBouleEngine } from '../../useCases/resolveGrandBouleEngine';
import { setGrandBouleAttackBite } from '../../useCases/setGrandBouleAttackBite';
import { setGrandBouleMasterGain } from '../../useCases/setGrandBouleMasterGain';
import { setGrandBouleMorphPosition } from '../../useCases/setGrandBouleMorphPosition';
import { resetGrandBoulePerNoteParams } from '../../useCases/setGrandBoulePerNoteParam/resetGrandBoulePerNoteParams';
import { setGrandBoulePerNoteParam } from '../../useCases/setGrandBoulePerNoteParam/setGrandBoulePerNoteParam';
import { setGrandBouleSostenuto } from '../../useCases/setGrandBouleSostenuto';
import { setGrandBouleSoundboardSend } from '../../useCases/setGrandBouleSoundboardSend';
import { setGrandBouleStretchAmount } from '../../useCases/setGrandBouleStretchAmount';
import { setGrandBouleSustain } from '../../useCases/setGrandBouleSustain';
import { setGrandBouleSympatheticSend } from '../../useCases/setGrandBouleSympatheticSend';
import { setGrandBouleTemperament } from '../../useCases/setGrandBouleTemperament';
import { setGrandBouleUnaCorda } from '../../useCases/setGrandBouleUnaCorda';
import { setGrandBouleVelocityCurve } from '../../useCases/setGrandBouleVelocityCurve';
import { triggerGrandBouleNote } from '../../useCases/triggerGrandBouleNote';
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
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
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
    // §52.1 — Derive the engine handle from a subscribed track list so the
    // React Compiler can memoize this across the many per-note re-renders
    // (setActiveNotes fires on every MIDI noteOn). Previously: full
    // getAllTracks().find() scan per render.
    const trackState = useStore(trackStore, defaultTrackState);
    const engine: ResolvedGrandBouleEngine = resolveGrandBouleEngine({ deviceId, tracks: trackState.tracks });
    // §209.1 — Typed default instead of non-null assertion on live value.
    const store = useMemo(() => createGrandBouleStore(deviceId), [deviceId]);
    const state = useStore(store, defaultGrandBouleState);
    const [activeNotes, setActiveNotes] = useState<ReadonlyMap<number, number>>(() => new Map());
    const [lidPosition, setLidPosition] = useState(1.0);
    const [lastVelocity, setLastVelocity] = useState(0);

    // Subscribe to external MIDI note events so the visual keyboard reflects
    // notes played on a physical controller (e.g. Akai).
    useEffect(() => {
        const unsubs = [
            onMidiNoteOn(({ deviceId: eventDeviceId, midiNote, velocity }) => {
                if (eventDeviceId && eventDeviceId !== deviceId) {
                    return;
                }
                setLastVelocity(Math.round(velocity * 127));
                setActiveNotes((prev) => {
                    const next = new Map(prev);
                    next.set(midiNote, velocity);
                    return next;
                });
            }),
            onMidiNoteOff(({ deviceId: eventDeviceId, midiNote }) => {
                if (eventDeviceId && eventDeviceId !== deviceId) {
                    return;
                }
                setActiveNotes((prev) => {
                    if (!prev.has(midiNote)) {
                        return prev;
                    }
                    const next = new Map(prev);
                    next.delete(midiNote);
                    return next;
                });
            }),
            onMidiPedalCc(({ deviceId: eventDeviceId, cc, value }) => {
                if (eventDeviceId && eventDeviceId !== deviceId) {
                    return;
                }
                const s = store.value;
                if (s === null) {
                    return;
                }
                if (cc === 64) {
                    store.set({ ...s, pedals: { ...s.pedals, sustain: value as number } });
                } else if (cc === 66) {
                    store.set({ ...s, pedals: { ...s.pedals, sostenuto: value as boolean } });
                } else if (cc === 67) {
                    store.set({ ...s, pedals: { ...s.pedals, unaCorda: value as boolean } });
                }
            }),
        ];
        return () => {
            for (const unsub of unsubs) {
                unsub();
            }
        };
    }, []);

    // On mount (or when the engine becomes available), dispatch the active
    // piano model's parameters so the DSP matches the UI from the start.
    const engineReady = engine.isReady();
    useEffect(() => {
        if (!engineReady) {
            return;
        }
        setGrandBouleMorphPosition({ engine, store, morphPosition: 0 });
    }, [engineReady]);

    // Read FFT data from the track's AnalyserNode for the spectral waterfall.
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
    useEffect(() => {
        if (!engineReady) {
            return;
        }
        const node = engine.getAnalyserNode();
        if (node !== null) {
            setAnalyser(node);
        }
    }, [engineReady, engine]);

    const liveState = state ?? store.value;
    if (liveState === null) {
        return <div className="h-full" />;
    }

    const { config, parameters, pedals, morph, temperament, activeVoices } = liveState;
    const presets = listGrandBoulePresets();

    const handleNoteOn = (midiNote: number, velocity: number): void => {
        triggerGrandBouleNote({ engine, store, midiNote, velocity });
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
                                        onClick={() => loadGrandBoulePreset({ engine, store, presetId: preset.id })}
                                        className={`grand-boule-window flex flex-col items-start gap-1 px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-neutral-400/40 bg-neutral-300/10'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                    >
                                        <span className="text-[11px] font-medium text-foreground">{preset.name}</span>
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
                                setGrandBouleMorphPosition({ engine, store, morphPosition: position })
                            }
                            onLayerBalanceChange={(balance) => {
                                const s = store.value;
                                if (s !== null) {
                                    store.set({ ...s, morph: { ...s.morph, layerBalance: balance } });
                                }
                            }}
                            onModelAChange={(modelId) => {
                                const s = store.value;
                                if (s !== null) {
                                    store.set({ ...s, morph: { ...s.morph, modelA: modelId } });
                                    setGrandBouleMorphPosition({ engine, store, morphPosition: s.morph.morphPosition });
                                }
                            }}
                            onModelBChange={(modelId) => {
                                const s = store.value;
                                if (s !== null) {
                                    store.set({ ...s, morph: { ...s.morph, modelB: modelId } });
                                    setGrandBouleMorphPosition({ engine, store, morphPosition: s.morph.morphPosition });
                                }
                            }}
                            onEnabledChange={(enabled) => {
                                const s = store.value;
                                if (s !== null) {
                                    store.set({ ...s, morph: { ...s.morph, enabled } });
                                }
                            }}
                        />
                    </SectionCard>

                    <SectionCard title="Mix" detail="Master, soundboard, sympathetic.">
                        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                            <Knob
                                value={config.masterGain}
                                onChange={(value) => setGrandBouleMasterGain({ engine, store, gain: value })}
                                label="Master"
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={0.7}
                                readout={`${Math.round(config.masterGain * 100)}%`}
                            />
                            <Knob
                                value={config.soundboardSend}
                                onChange={(value) => setGrandBouleSoundboardSend({ engine, store, amount: value })}
                                label="Board"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.6}
                                readout={`${Math.round(config.soundboardSend * 100)}%`}
                            />
                            <Knob
                                value={config.sympatheticSend}
                                onChange={(value) => setGrandBouleSympatheticSend({ engine, store, amount: value })}
                                label="Symp"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.25}
                                readout={`${Math.round(config.sympatheticSend * 100)}%`}
                            />
                        </div>
                    </SectionCard>
                    <SectionCard title="Realism" detail="Stretched tuning + attack bite (appendix §A6, §A8).">
                        <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                            <Knob
                                value={config.stretchAmount}
                                onChange={(value) => setGrandBouleStretchAmount({ engine, store, amount: value })}
                                label="Stretch"
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={1.0}
                                readout={`${Math.round(config.stretchAmount * 100)}%`}
                            />
                            <Knob
                                value={config.attackBite}
                                onChange={(value) => setGrandBouleAttackBite({ engine, store, amount: value })}
                                label="Bite"
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={1.0}
                                readout={`${Math.round(config.attackBite * 100)}%`}
                            />
                        </div>
                    </SectionCard>
                    <SectionCard title="Per-Note" detail="Key-specific parameter editing (§3.1).">
                        <PerNoteEditor
                            perNoteOverrides={liveState.perNoteOverrides}
                            onParamChange={(key, param, value) =>
                                setGrandBoulePerNoteParam({
                                    engine,
                                    store,
                                    key,
                                    param,
                                    value,
                                    perNoteMap: liveState.perNoteOverrides,
                                    setPerNoteMap: (next) => {
                                        const s = store.value;
                                        if (s !== null) {
                                            store.set({ ...s, perNoteOverrides: next });
                                        }
                                    },
                                })
                            }
                            onReset={(key) =>
                                resetGrandBoulePerNoteParams({
                                    engine,
                                    store,
                                    key,
                                    perNoteMap: liveState.perNoteOverrides,
                                    setPerNoteMap: (next) => {
                                        const s = store.value;
                                        if (s !== null) {
                                            store.set({ ...s, perNoteOverrides: next });
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
                            onVelocityCurveExponentChange={(value) => setVelocityCurveExponent({ store, value })}
                            onVelocityFloorChange={(value) => setVelocityFloor({ store, value })}
                            onVelocityCeilingChange={(value) => setVelocityCeiling({ store, value })}
                            onCcSmoothingMsChange={(value) => setCcSmoothingMs({ store, value })}
                            onSustainThresholdChange={(value) => setSustainThreshold({ store, value })}
                            onAfterTouchSensitivityChange={(value) => setAfterTouchSensitivity({ store, value })}
                            onReset={() => resetMidiCalibration({ store })}
                        />
                    </SectionCard>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-neutral-400/80">
                                Grand Boule
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">Physical Modeling Piano</div>
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
                        <StringVibrationView activeNotes={activeNotes} className="h-full w-full" />
                    </div>

                    <div className="grand-boule-window min-h-0 shrink-0 overflow-hidden p-2" style={{ height: 160 }}>
                        <SpectralWaterfall analyser={analyser} className="h-full w-full" />
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Pedals" detail="Sustain, una corda, sostenuto.">
                        <div className="flex flex-col gap-3">
                            <Knob
                                value={pedals.sustain}
                                onChange={(value) => setGrandBouleSustain({ engine, store, position: value })}
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
                                            store,
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
                                            store,
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
                                                store,
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
                            onChange={(value) => setGrandBouleVelocityCurve({ engine, store, exponent: value })}
                            label="Curve"
                            min={0.5}
                            max={2}
                            step={0.05}
                            defaultValue={1.0}
                            readout={(() => {
                                if (parameters.velocityCurve < 0.95) {
                                    return 'soft';
                                }
                                if (parameters.velocityCurve > 1.05) {
                                    return 'hard';
                                }
                                return 'linear';
                            })()}
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
                            readout={(() => {
                                if (lidPosition < 0.3) {
                                    return 'closed';
                                }
                                if (lidPosition < 0.7) {
                                    return 'half';
                                }
                                return 'full';
                            })()}
                        />
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
