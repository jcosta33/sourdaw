import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Power } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { defaultGrandBouleState, createGrandBouleStore, type TemperamentIndex } from '../../stores/grandBouleStore';
import { applyGrandBouleMorphState } from '../../useCases/applyGrandBouleMorphState';
import { resetMidiCalibration } from '../../useCases/calibrateGrandBouleMidi/resetMidiCalibration';
import { setCcSmoothingMs } from '../../useCases/calibrateGrandBouleMidi/setCcSmoothingMs';
import { setSustainThreshold } from '../../useCases/calibrateGrandBouleMidi/setSustainThreshold';
import { setVelocityCeiling } from '../../useCases/calibrateGrandBouleMidi/setVelocityCeiling';
import { setVelocityCurveExponent } from '../../useCases/calibrateGrandBouleMidi/setVelocityCurveExponent';
import { setVelocityFloor } from '../../useCases/calibrateGrandBouleMidi/setVelocityFloor';
import { syncMidiCalibrationToEngine } from '../../useCases/calibrateGrandBouleMidi/syncMidiCalibrationToEngine';
import { findMatchingGrandBoulePresetId } from '../../useCases/findMatchingGrandBoulePresetId';
import { hydrateGrandBouleConfigFromProject } from '../../useCases/hydrateGrandBouleConfigFromProject';
import { listGrandBoulePresets } from '../../useCases/listGrandBoulePresets';
import { loadGrandBoulePreset } from '../../useCases/loadGrandBoulePreset';
import { onMidiNoteOff } from '../../useCases/midiEventSubscribers/onMidiNoteOff';
import { onMidiNoteOn } from '../../useCases/midiEventSubscribers/onMidiNoteOn';
import { onMidiPedalCc } from '../../useCases/midiEventSubscribers/onMidiPedalCc';
import { panicGrandBoule } from '../../useCases/panicGrandBoule';
import { resolveGrandBouleEngine, type ResolvedGrandBouleEngine } from '../../useCases/resolveGrandBouleEngine';
import { setGrandBouleAttackBite } from '../../useCases/setGrandBouleAttackBite';
import { setGrandBouleMasterGain } from '../../useCases/setGrandBouleMasterGain';
import { setGrandBouleMorphBalance } from '../../useCases/setGrandBouleMorphBalance';
import { setGrandBouleMorphEnabled } from '../../useCases/setGrandBouleMorphEnabled';
import { setGrandBouleMorphModel } from '../../useCases/setGrandBouleMorphModel';
import { setGrandBouleMorphPosition } from '../../useCases/setGrandBouleMorphPosition';
import { resetGrandBoulePerNoteParams } from '../../useCases/setGrandBoulePerNoteParam/resetGrandBoulePerNoteParams';
import { setGrandBoulePerNoteParam } from '../../useCases/setGrandBoulePerNoteParam/setGrandBoulePerNoteParam';
import { setGrandBouleRadiationParam } from '../../useCases/setGrandBouleRadiationParam';
import { setGrandBouleSostenuto } from '../../useCases/setGrandBouleSostenuto';
import { setGrandBouleSoundboardSend } from '../../useCases/setGrandBouleSoundboardSend';
import { setGrandBouleStretchAmount } from '../../useCases/setGrandBouleStretchAmount';
import { setGrandBouleSustain } from '../../useCases/setGrandBouleSustain';
import { setGrandBouleSympatheticSend } from '../../useCases/setGrandBouleSympatheticSend';
import { setGrandBouleTemperament } from '../../useCases/setGrandBouleTemperament';
import { setGrandBouleUnaCorda } from '../../useCases/setGrandBouleUnaCorda';
import { setGrandBouleVelocityCurve } from '../../useCases/setGrandBouleVelocityCurve';
import { startGrandBoulePreviewNote } from '../../useCases/triggerGrandBouleNote';
import { GrandBouleVisualizations, type GrandBouleVisualization } from '../components/GrandBouleVisualizations';
import { MidiCalibrationPanel } from '../components/MidiCalibrationPanel';
import { MorphPanel } from '../components/MorphPanel';
import { PerNoteEditor } from '../components/PerNoteEditor';
import { GRAND_BOULE_PER_NOTE_AVAILABLE } from '../helpers/perNoteAvailability';

/**
 * Grand Boule piano plugin panel.
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
        className="grand-boule-window shrink-0"
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
    // `RotaryKnob` reports a drag with `isTransient: true` and the release with
    // `false`. This wrapper declared a one-argument `onChange` and so discarded the
    // flag, which left the Mix knobs with no gesture boundary to commit on.
    onChange: (value: number, isTransient?: boolean) => void;
    readout: string;
}): ReactElement => (
    <Stack align="center" gap={1}>
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            aria-label={label}
        />
        <div className="text-center">
            <div className="text-micro uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-caption text-foreground/85">{readout}</div>
        </div>
    </Stack>
);

/**
 * Narrow a `MidiPedalCcPayload.value` (`number | boolean`) to a continuous
 * 0..1 position for the sustain pedal (CC64). A boolean maps to its extremes;
 * the use case clamps the number into range.
 */
const pedalContinuous = (value: number | boolean): number => {
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    return value;
};

/**
 * Narrow a `MidiPedalCcPayload.value` to an on/off state for the binary pedals
 * (CC66 sostenuto, CC67 una corda). A number is engaged past the MIDI-standard
 * half-way point.
 */
const pedalEngaged = (value: number | boolean): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }
    return value >= 0.5;
};

const TEMPERAMENT_OPTIONS = [
    { value: 0 as TemperamentIndex, label: 'Equal' },
    { value: 1 as TemperamentIndex, label: 'Werckmeister III' },
    { value: 2 as TemperamentIndex, label: 'Kirnberger III' },
    { value: 3 as TemperamentIndex, label: 'Vallotti' },
    { value: 4 as TemperamentIndex, label: 'Young II' },
    { value: 5 as TemperamentIndex, label: 'Meantone ¼' },
] as const;

const MICROPHONE_POSITIONS = [
    { value: 0, label: 'Close' },
    { value: 1, label: 'Player' },
    { value: 2, label: 'Room' },
] as const;

export const GrandBoulePanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // Derive the engine handle from a subscribed track list so the
    // React Compiler can memoize this across the many per-note re-renders
    // (note state changes on every MIDI noteOn). Previously: full
    // getAllTracks().find() scan per render.
    const trackState = useStore(trackStore, defaultTrackState);
    const projectParameterValues = trackState.tracks
        .flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)?.parameterValues;
    const engine: ResolvedGrandBouleEngine = resolveGrandBouleEngine({ deviceId, tracks: trackState.tracks });
    // Keep the live value typed without a non-null assertion.
    const store = createGrandBouleStore(deviceId);
    const state = useStore(store, defaultGrandBouleState);
    const [externalNotes, setExternalNotes] = useState<ReadonlyMap<number, number>>(() => new Map());
    const [previewNotes, setPreviewNotes] = useState<ReadonlyMap<object, { midiNote: number; velocity: number }>>(
        () => new Map()
    );
    const activeNotes = new Map(externalNotes);
    for (const { midiNote, velocity } of previewNotes.values()) {
        activeNotes.set(midiNote, velocity);
    }
    const [lastVelocity, setLastVelocity] = useState(0);
    const [openVisualizations, setOpenVisualizations] = useState<GrandBouleVisualization[]>([]);
    const [pianoPreviewHeld, setPianoPreviewHeld] = useState(false);

    // The pedal subscriber dispatches through use cases that need the live
    // engine/store. Both are recomputed each render (engine is a fresh handle,
    // store is the per-device instance), so mirror them into refs and read
    // `*.current` inside the long-lived subscription rather than closing over a
    // stale value.
    const engineRef = useRef(engine);
    const storeRef = useRef(store);
    useEffect(() => {
        engineRef.current = engine;
        storeRef.current = store;
    }, [engine, store]);

    // Seed the session config from project truth before the user can touch a Mix
    // knob. `projectTrackToLiveStrip` restores the engine from the same values on
    // project open, so without this the panel would draw its module defaults over a
    // correctly-restored piano and the first knob move would persist the default.
    useEffect(() => {
        hydrateGrandBouleConfigFromProject(deviceId);
    }, [
        deviceId,
        projectParameterValues?.lidPosition,
        projectParameterValues?.masterGain,
        projectParameterValues?.micPosition,
        projectParameterValues?.soundboardSend,
        projectParameterValues?.sympatheticSend,
    ]);

    // Subscribe to external MIDI note events so the visual keyboard reflects
    // notes played on a physical controller (e.g. Akai). Re-subscribe when the
    // device changes so the filters and store writes target the new device.
    useEffect(() => {
        const unsubs = [
            onMidiNoteOn(({ deviceId: eventDeviceId, midiNote, velocity }) => {
                if (eventDeviceId && eventDeviceId !== deviceId) {
                    return;
                }
                setLastVelocity(Math.round(velocity * 127));
                setExternalNotes((prev) => {
                    const next = new Map(prev);
                    next.set(midiNote, velocity);
                    return next;
                });
            }),
            onMidiNoteOff(({ deviceId: eventDeviceId, midiNote }) => {
                if (eventDeviceId && eventDeviceId !== deviceId) {
                    return;
                }
                setExternalNotes((prev) => {
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
                // `value` is `number | boolean`; narrow it at runtime (never
                // `as`-cast) and route through the pedal use cases so the store
                // stays clamped/consistent.
                //
                // No engine: this is an echo of a pedal `routePedalToBodies`
                // has already delivered to both bodies. Writing it again would
                // re-send the identical value and queue a second native
                // controller message for every movement the panel is open for.
                const liveStore = storeRef.current;
                if (cc === 64) {
                    setGrandBouleSustain({ store: liveStore, position: pedalContinuous(value) });
                } else if (cc === 66) {
                    setGrandBouleSostenuto({ store: liveStore, engaged: pedalEngaged(value) });
                } else if (cc === 67) {
                    setGrandBouleUnaCorda({ store: liveStore, engaged: pedalEngaged(value) });
                }
            }),
        ];
        return () => {
            for (const unsub of unsubs) {
                unsub();
            }
        };
    }, [deviceId]);

    // On mount (or when the engine becomes available), dispatch the active
    // piano model's parameters so the DSP matches the UI from the start.
    const engineReady = engine.isReady();
    // eslint-disable-next-line sourdaw/no-useeffect-derived-state -- side-effectful use-case call triggered by engine readiness, not state derivation
    useEffect(() => {
        if (!engineReady) {
            return;
        }
        const currentMorph = storeRef.current.value?.morph;
        if (currentMorph) {
            applyGrandBouleMorphState(engineRef.current, currentMorph);
        }
        // The two engine-consumed calibration values live on the store, which
        // outlives any one engine instance (`storesByDevice` is a module Map).
        // A device node rebuilt underneath a calibrated panel comes up on the
        // DSP defaults, so re-push them rather than leaving the readout
        // describing a piano that is not playing.
        syncMidiCalibrationToEngine({ engine: engineRef.current, store: storeRef.current });
    }, [engineReady]);

    // Read FFT data from the track's AnalyserNode for the spectral waterfall,
    // and pass the engine context sample rate so its frequency axis is scaled
    // for the real rate (44.1 kHz vs 48 kHz) rather than a hardcoded default.
    const analyser = engineReady ? engine.getAnalyserNode() : null;
    const engineSampleRate = engineReady ? engine.sampleRate() : undefined;

    const liveState = state;
    const { config, parameters, pedals, morph, temperament } = liveState;
    const presets = listGrandBoulePresets();
    const matchingPresetId = findMatchingGrandBoulePresetId(parameters);

    const handlePreviewNote = (midiNote: number, velocity: number): (() => void) | undefined => {
        const release = startGrandBoulePreviewNote({ engine, store, midiNote, velocity });
        if (release === undefined) {
            return undefined;
        }
        const owner = {};
        setLastVelocity(Math.round(velocity * 127));
        setPreviewNotes((previous) => new Map(previous).set(owner, { midiNote, velocity }));
        return () => {
            release();
            setPreviewNotes((previous) => {
                const next = new Map(previous);
                next.delete(owner);
                return next;
            });
        };
    };

    let velocityCurveReadout = 'linear';
    if (parameters.velocityCurve < 0.95) {
        velocityCurveReadout = 'soft';
    } else if (parameters.velocityCurve > 1.05) {
        velocityCurveReadout = 'hard';
    }

    const handleToggleVisualization = (visualization: GrandBouleVisualization): void => {
        setOpenVisualizations((current) => {
            if (current.includes(visualization)) {
                return current.filter((open) => open !== visualization);
            }
            return [...current, visualization];
        });
    };

    return (
        <div
            className="grand-boule-faceplate @container flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-[26px] p-3"
            role="region"
            aria-label="Grand Boule controls"
        >
            <GrandBouleVisualizations
                deviceId={deviceId}
                activeNotes={activeNotes}
                sustainPedal={pedals.sustain}
                lidPosition={config.lidPosition}
                engineReady={engineReady}
                analyser={analyser}
                sampleRate={engineSampleRate}
                openVisualizations={openVisualizations}
                pianoPreviewHeld={pianoPreviewHeld}
                onToggleVisualization={handleToggleVisualization}
                onPreviewHoldChange={setPianoPreviewHeld}
                onPreviewNote={handlePreviewNote}
            />

            <div className="grid shrink-0 items-start gap-3 @[36rem]:grid-cols-2 @[54rem]:grid-cols-3">
                <Stack gap={3} className="min-w-0">
                    <SectionCard title="Preset shelf" detail="Signature Grand Boule voicings.">
                        <Stack gap={1}>
                            {presets.map((preset) => {
                                const active = matchingPresetId === preset.id;
                                return (
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        key={preset.id}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() =>
                                            loadGrandBoulePreset({ deviceId, engine, store, presetId: preset.id })
                                        }
                                        className={`grand-boule-window flex flex-col items-start gap-1 whitespace-normal wrap-anywhere px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-neutral-400/40 bg-neutral-300/10'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                    >
                                        <span className="text-compact font-medium text-foreground">{preset.name}</span>
                                        <span className="text-caption leading-tight text-muted-foreground">
                                            {preset.description}
                                        </span>
                                    </Button>
                                );
                            })}
                        </Stack>
                    </SectionCard>

                    <MorphPanel
                        morph={morph}
                        onMorphPositionChange={(position, isTransient) =>
                            setGrandBouleMorphPosition({
                                deviceId,
                                engine,
                                store,
                                morphPosition: position,
                                isTransient,
                            })
                        }
                        onLayerBalanceChange={(balance, isTransient) =>
                            setGrandBouleMorphBalance({ deviceId, engine, store, balance, isTransient })
                        }
                        onModelAChange={(modelId) =>
                            setGrandBouleMorphModel({ deviceId, engine, store, slot: 'modelA', modelId })
                        }
                        onModelBChange={(modelId) =>
                            setGrandBouleMorphModel({ deviceId, engine, store, slot: 'modelB', modelId })
                        }
                        onEnabledChange={(enabled) => setGrandBouleMorphEnabled({ deviceId, engine, store, enabled })}
                    />
                </Stack>
                <Stack gap={3} className="min-w-0">
                    <SectionCard title="Mix" detail="Master, soundboard, sympathetic.">
                        <Grid cols={3} gapX={2} gapY={3}>
                            <Knob
                                value={config.masterGain}
                                onChange={(value, isTransient) =>
                                    setGrandBouleMasterGain({ deviceId, engine, store, gain: value, isTransient })
                                }
                                label="Master"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.1}
                                readout={`${Math.round(config.masterGain * 100)}%`}
                            />
                            <Knob
                                value={config.soundboardSend}
                                onChange={(value, isTransient) =>
                                    setGrandBouleSoundboardSend({
                                        deviceId,
                                        engine,
                                        store,
                                        amount: value,
                                        isTransient,
                                    })
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
                                onChange={(value, isTransient) =>
                                    setGrandBouleSympatheticSend({
                                        deviceId,
                                        engine,
                                        store,
                                        amount: value,
                                        isTransient,
                                    })
                                }
                                label="Symp"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.25}
                                readout={`${Math.round(config.sympatheticSend * 100)}%`}
                            />
                        </Grid>
                    </SectionCard>
                    <SectionCard title="Radiation" detail="Audible lid transfer and microphone perspective.">
                        <Grid cols={2} gap={2} className="items-center">
                            <Knob
                                value={config.lidPosition}
                                onChange={(value, isTransient) =>
                                    setGrandBouleRadiationParam({
                                        deviceId,
                                        engine,
                                        store,
                                        paramId: 'lidPosition',
                                        value,
                                        isTransient,
                                    })
                                }
                                label="Lid position"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={1}
                                readout={`${Math.round(config.lidPosition * 100)}% open`}
                            />
                            <Stack
                                as="label"
                                gap={1}
                                className="min-w-0 items-start text-caption text-muted-foreground"
                            >
                                Microphone
                                <DawCompactSelect
                                    aria-label="Microphone position"
                                    className="max-w-full"
                                    value={config.micPosition}
                                    onChange={(event) =>
                                        setGrandBouleRadiationParam({
                                            deviceId,
                                            engine,
                                            store,
                                            paramId: 'micPosition',
                                            value: Number(event.currentTarget.value),
                                        })
                                    }
                                >
                                    {MICROPHONE_POSITIONS.map((position) => (
                                        <option key={position.value} value={position.value}>
                                            {position.label}
                                        </option>
                                    ))}
                                </DawCompactSelect>
                            </Stack>
                        </Grid>
                    </SectionCard>
                    <SectionCard title="Realism" detail="Stretched tuning and attack bite.">
                        <Grid cols={2} gapX={2} gapY={3}>
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
                        </Grid>
                    </SectionCard>
                    <SectionCard title="Per-Note" detail="Key-specific parameter editing.">
                        {GRAND_BOULE_PER_NOTE_AVAILABLE ? (
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
                        ) : (
                            <DawBlockedState
                                compact
                                eyebrow="Per-Note Voicing"
                                title="Per-note voicing not yet active"
                                description="Per-key overrides are captured but the piano engine does not apply them yet."
                                summary="These controls return once the per-note engine path lands."
                            />
                        )}
                    </SectionCard>

                    <MidiCalibrationPanel
                        calibration={liveState.midiCalibration}
                        lastVelocity={lastVelocity}
                        onVelocityCurveExponentChange={(value) => setVelocityCurveExponent({ store, value })}
                        onVelocityFloorChange={(value) => setVelocityFloor({ store, value })}
                        onVelocityCeilingChange={(value) => setVelocityCeiling({ store, value })}
                        onCcSmoothingMsChange={(value) => setCcSmoothingMs({ engine, store, value })}
                        onSustainThresholdChange={(value) => setSustainThreshold({ engine, store, value })}
                        onReset={() => resetMidiCalibration({ engine, store })}
                    />
                </Stack>

                <Stack
                    gap={3}
                    className="min-w-0 @[36rem]:col-span-2 @[36rem]:grid @[36rem]:grid-cols-2 @[54rem]:col-span-1 @[54rem]:flex"
                >
                    <SectionCard title="Pedals" detail="Sustain, una corda, sostenuto.">
                        <Stack gap={3}>
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
                            <Row justify="between" gap={2}>
                                <span className="text-caption uppercase tracking-[0.18em] text-muted-foreground/60">
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
                            </Row>
                            <Row justify="between" gap={2}>
                                <span className="text-caption uppercase tracking-[0.18em] text-muted-foreground/60">
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
                            </Row>
                        </Stack>
                    </SectionCard>

                    <SectionCard title="Tuning" detail="Historical temperament.">
                        <Stack gap={1}>
                            {TEMPERAMENT_OPTIONS.map((option) => {
                                const active = temperament === option.value;
                                return (
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        key={option.value}
                                        type="button"
                                        onClick={() =>
                                            setGrandBouleTemperament({
                                                deviceId,
                                                store,
                                                temperament: option.value,
                                            })
                                        }
                                        className={`rounded-sm px-2 py-1 text-left text-dense transition-colors ${
                                            active
                                                ? 'bg-neutral-300/15 text-neutral-200 font-medium'
                                                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                                        }`}
                                    >
                                        {option.label}
                                    </Button>
                                );
                            })}
                        </Stack>
                    </SectionCard>

                    <SectionCard title="Touch" detail="Velocity curve shaping.">
                        <Knob
                            value={parameters.velocityCurve}
                            onChange={(value, isTransient) =>
                                setGrandBouleVelocityCurve({
                                    deviceId,
                                    engine,
                                    store,
                                    exponent: value,
                                    isTransient,
                                })
                            }
                            label="Curve"
                            min={0.5}
                            max={2}
                            step={0.05}
                            defaultValue={1.0}
                            readout={velocityCurveReadout}
                        />
                    </SectionCard>

                    <SectionCard title="Transport" detail="Panic — silence every voice.">
                        <Row gap={2}>
                            <DawPluginChip
                                tone="danger"
                                size="sm"
                                onClick={() => {
                                    panicGrandBoule({ engine });
                                    setExternalNotes(new Map());
                                    setPreviewNotes(new Map());
                                }}
                            >
                                <Power className="size-3.5" />
                                Panic
                            </DawPluginChip>
                        </Row>
                    </SectionCard>
                </Stack>
            </div>
        </div>
    );
};
