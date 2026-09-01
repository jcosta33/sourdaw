import {
    type ChangeEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';

import { Plus, Trash2, X } from 'lucide-react';

import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { getPluginById } from '#/modules/Arrangement/useCases';

import { type Modulator, type ModulatorKind, type ModulatorMapping } from '../../models/Modulator';
import { modulationStore, type ModulationStoreState } from '../../stores/modulationStore';
import { addMapping } from '../../useCases/modulation/addMapping';
import { addModulator } from '../../useCases/modulation/addModulator';
import { beginMappingAmountDrag } from '../../useCases/modulation/beginMappingAmountDrag';
import { endMappingAmountDrag } from '../../useCases/modulation/endMappingAmountDrag';
import { isMappingAmountDragActive } from '../../useCases/modulation/isMappingAmountDragActive';
import { paintMappingAmountDrag } from '../../useCases/modulation/paintMappingAmountDrag';
import { type MappingTarget, removeMapping } from '../../useCases/modulation/removeMapping';
import { removeModulator } from '../../useCases/modulation/removeModulator';
import { updateModulator } from '../../useCases/modulation/updateModulator';

type DeviceRef = {
    id: string;
    name: string;
    type: string;
};

type TrackRef = {
    id: string;
    name: string;
    devices: DeviceRef[];
};

const emptyModState: ModulationStoreState = { modulators: [] };

const KIND_LABELS: Record<ModulatorKind, string> = {
    lfo: 'LFO',
    envelope: 'Envelope',
    step: 'Step',
};

type DestinationLabel = {
    trackName: string;
    deviceName: string;
    paramName: string;
};

function describeDestination(tracks: TrackRef[], mapping: ModulatorMapping): DestinationLabel | null {
    const track = tracks.find((t) => t.id === mapping.targetTrackId);
    if (!track) {
        return null;
    }
    const device = track.devices.find((d) => d.id === mapping.targetDeviceId);
    if (!device) {
        return null;
    }
    const descriptor = getPluginById(device.type);
    const param = descriptor?.parameters.find((p) => p.id === mapping.targetParamId);
    if (!param) {
        return null;
    }
    return {
        trackName: track.name,
        deviceName: device.name,
        paramName: param.name,
    };
}

type FormState = {
    name: string;
    kind: ModulatorKind;
    trackId: string;
    lfoRate: string;
    lfoWaveform: 'sine' | 'square' | 'saw' | 'triangle' | 'random';
    envAttack: string;
    envDecay: string;
    envSustain: string;
    envRelease: string;
    stepCount: string;
};

const DEFAULT_FORM: FormState = {
    name: 'LFO',
    kind: 'lfo',
    trackId: '',
    lfoRate: '1',
    lfoWaveform: 'sine',
    envAttack: '0.01',
    envDecay: '0.2',
    envSustain: '0.5',
    envRelease: '0.3',
    stepCount: '8',
};

function buildModulator(form: FormState): Omit<Modulator, 'id'> | null {
    if (form.trackId === '') {
        return null;
    }
    if (form.kind === 'lfo') {
        const rate = Number.parseFloat(form.lfoRate);
        return {
            name: form.name,
            trackId: form.trackId,
            kind: 'lfo',
            config: {
                kind: 'lfo',
                waveform: form.lfoWaveform,
                rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
                sync: true,
                phase: 0,
                depth: 1,
            },
            mappings: [],
            enabled: true,
        };
    }
    if (form.kind === 'envelope') {
        const attack = Number.parseFloat(form.envAttack);
        const decay = Number.parseFloat(form.envDecay);
        const sustain = Number.parseFloat(form.envSustain);
        const release = Number.parseFloat(form.envRelease);
        return {
            name: form.name,
            trackId: form.trackId,
            kind: 'envelope',
            config: {
                kind: 'envelope',
                attack: Number.isFinite(attack) ? Math.max(0, attack) : 0.01,
                decay: Number.isFinite(decay) ? Math.max(0, decay) : 0.2,
                sustain: Number.isFinite(sustain) ? Math.max(0, Math.min(1, sustain)) : 0.5,
                release: Number.isFinite(release) ? Math.max(0, release) : 0.3,
                triggerMode: 'midi',
            },
            mappings: [],
            enabled: true,
        };
    }
    const count = Number.parseInt(form.stepCount, 10);
    const length = Number.isFinite(count) && count > 0 ? Math.min(64, count) : 8;
    return {
        name: form.name,
        trackId: form.trackId,
        kind: 'step',
        config: {
            kind: 'step',
            steps: Array.from({ length }, (_, i) => i / Math.max(1, length - 1)),
            rate: 1,
            smooth: 0,
        },
        mappings: [],
        enabled: true,
    };
}

type NewModulatorFormProps = {
    tracks: TrackRef[];
    onClose: () => void;
};

const NewModulatorForm = ({ tracks, onClose }: NewModulatorFormProps): ReactElement => {
    const defaultTrackId = tracks[0]?.id ?? '';
    const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM, trackId: defaultTrackId });

    // The form can open before tracks hydrate (fresh project load); a one-shot
    // seed would pin trackId to '' forever and leave Add permanently disabled
    // (`addModulator` refuses an empty trackId). Resync the default selection
    // whenever the track list changes, the way the voicebank picker in
    // ClipMidiAiSection resyncs against its registry.
    useEffect(() => {
        setForm((prev) => {
            if (tracks.length === 0) {
                return prev.trackId === '' ? prev : { ...prev, trackId: '' };
            }
            return tracks.some((track) => track.id === prev.trackId) ? prev : { ...prev, trackId: tracks[0]!.id };
        });
    }, [tracks]);

    const setField = <Key extends keyof FormState>(key: Key, value: FormState[Key]): void => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmit = (): void => {
        const built = buildModulator(form);
        if (!built) {
            return;
        }
        addModulator(built);
        onClose();
    };

    return (
        <Stack gap={2} className="border-b border-border-hairline bg-surface-inset p-3">
            <Row justify="between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    New Modulator
                </span>
                <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close new modulator form">
                    <X className="size-3.5" />
                </Button>
            </Row>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
                <label className="text-[10px] text-muted-foreground">Name</label>
                <DawCompactInput
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    aria-label="Modulator name"
                />
                <label className="text-[10px] text-muted-foreground">Kind</label>
                <DawCompactSelect
                    value={form.kind}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        setField('kind', event.target.value as ModulatorKind)
                    }
                    aria-label="Modulator kind"
                >
                    {/* Envelope is hidden: an ADSR needs a trigger/gate time the
                        modulation evaluator does not carry, so the card's ADSR
                        inputs drove nothing (computeModulatorValue returns 0 for
                        'envelope'). Restore the option once a trigger model exists. */}
                    <option value="lfo">LFO</option>
                    <option value="step">Step</option>
                </DawCompactSelect>
                <label className="text-[10px] text-muted-foreground">Track</label>
                <DawCompactSelect
                    value={form.trackId}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setField('trackId', event.target.value)}
                    aria-label="Modulator track scope"
                >
                    {tracks.length === 0 ? <option value="">No tracks available</option> : null}
                    {tracks.map((track) => (
                        <option key={track.id} value={track.id}>
                            {track.name}
                        </option>
                    ))}
                </DawCompactSelect>

                {form.kind === 'lfo' ? (
                    <>
                        <label className="text-[10px] text-muted-foreground">Waveform</label>
                        <DawCompactSelect
                            value={form.lfoWaveform}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                                setField('lfoWaveform', event.target.value as FormState['lfoWaveform'])
                            }
                            aria-label="LFO waveform"
                        >
                            <option value="sine">Sine</option>
                            <option value="triangle">Triangle</option>
                            <option value="saw">Saw</option>
                            <option value="square">Square</option>
                            <option value="random">Random</option>
                        </DawCompactSelect>
                        <label className="text-[10px] text-muted-foreground">Rate (beats)</label>
                        <DawCompactInput
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={form.lfoRate}
                            onChange={(event) => setField('lfoRate', event.target.value)}
                            aria-label="LFO rate in beats"
                        />
                    </>
                ) : null}

                {/* Envelope inputs intentionally omitted: the 'envelope' kind is
                    hidden from the picker until the evaluator supports a
                    trigger/gate time. `buildModulator` keeps its envelope branch
                    so a project that already contains one round-trips. */}

                {form.kind === 'step' ? (
                    <>
                        <label className="text-[10px] text-muted-foreground">Steps</label>
                        <DawCompactInput
                            type="number"
                            min="1"
                            max="64"
                            step="1"
                            value={form.stepCount}
                            onChange={(event) => setField('stepCount', event.target.value)}
                        />
                    </>
                ) : null}
            </div>
            <Row justify="end" gap={2} className="pt-1">
                <Button variant="ghost" size="xs" onClick={onClose}>
                    Cancel
                </Button>
                <Button variant="secondary" size="xs" onClick={handleSubmit} disabled={form.trackId === ''}>
                    <Plus className="size-3" />
                    <span className="ml-1">Add</span>
                </Button>
            </Row>
        </Stack>
    );
};

type AddMappingPickerProps = {
    modulatorId: string;
    tracks: TrackRef[];
    onClose: () => void;
};

const AddMappingPicker = ({ modulatorId, tracks, onClose }: AddMappingPickerProps): ReactElement => {
    const initialTrackId = tracks[0]?.id ?? '';
    const [trackId, setTrackId] = useState(initialTrackId);
    const selectedTrack = tracks.find((t) => t.id === trackId);
    const initialDeviceId = selectedTrack?.devices[0]?.id ?? '';
    const [deviceId, setDeviceId] = useState(initialDeviceId);
    const selectedDevice = selectedTrack?.devices.find((d) => d.id === deviceId);
    const descriptor = selectedDevice ? getPluginById(selectedDevice.type) : undefined;
    const automatable = descriptor?.parameters.filter((p) => p.automatable) ?? [];
    const initialParamId = automatable[0]?.id ?? '';
    const [paramId, setParamId] = useState(initialParamId);

    const handleTrackChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextTrackId = event.target.value;
        setTrackId(nextTrackId);
        const nextTrack = tracks.find((t) => t.id === nextTrackId);
        const nextDeviceId = nextTrack?.devices[0]?.id ?? '';
        setDeviceId(nextDeviceId);
        const nextDevice = nextTrack?.devices.find((d) => d.id === nextDeviceId);
        const nextDescriptor = nextDevice ? getPluginById(nextDevice.type) : undefined;
        setParamId(nextDescriptor?.parameters.find((p) => p.automatable)?.id ?? '');
    };

    const handleDeviceChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextDeviceId = event.target.value;
        setDeviceId(nextDeviceId);
        const nextDevice = selectedTrack?.devices.find((d) => d.id === nextDeviceId);
        const nextDescriptor = nextDevice ? getPluginById(nextDevice.type) : undefined;
        setParamId(nextDescriptor?.parameters.find((p) => p.automatable)?.id ?? '');
    };

    const canAdd = trackId !== '' && deviceId !== '' && paramId !== '';

    const handleAdd = (): void => {
        if (!canAdd) {
            return;
        }
        addMapping(modulatorId, {
            targetTrackId: trackId,
            targetDeviceId: deviceId,
            targetParamId: paramId,
            amount: 0.5,
        });
        onClose();
    };

    return (
        <Row wrap gap={2} className="rounded-sm bg-surface-inset px-2 py-1.5">
            <DawCompactSelect value={trackId} onChange={handleTrackChange} aria-label="Target track">
                {tracks.length === 0 ? <option value="">No tracks</option> : null}
                {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                        {track.name}
                    </option>
                ))}
            </DawCompactSelect>
            <DawCompactSelect
                value={deviceId}
                onChange={handleDeviceChange}
                aria-label="Target device"
                disabled={!selectedTrack || selectedTrack.devices.length === 0}
            >
                {!selectedTrack || selectedTrack.devices.length === 0 ? <option value="">No devices</option> : null}
                {selectedTrack?.devices.map((device) => (
                    <option key={device.id} value={device.id}>
                        {device.name}
                    </option>
                ))}
            </DawCompactSelect>
            <DawCompactSelect
                value={paramId}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => setParamId(event.target.value)}
                aria-label="Target parameter"
                disabled={automatable.length === 0}
            >
                {automatable.length === 0 ? <option value="">No automatable params</option> : null}
                {automatable.map((param) => (
                    <option key={param.id} value={param.id}>
                        {param.name}
                    </option>
                ))}
            </DawCompactSelect>
            <Button variant="secondary" size="xs" onClick={handleAdd} disabled={!canAdd}>
                Add
            </Button>
            <Button variant="ghost" size="xs" onClick={onClose}>
                Cancel
            </Button>
        </Row>
    );
};

type MappingRowProps = {
    modulator: Modulator;
    mapping: ModulatorMapping;
    destination: DestinationLabel | null;
};

/**
 * End one mapping's amount-drag gesture from the window, not from the input's
 * own pointerup: a pointerup landing outside the input (window focus lost
 * mid-drag, an overlay swallowing it) never fires the input's React handlers,
 * and the per-frame flush would keep committing the partial amount with no
 * undo entry. This is the slider-drag counterpart of `startMouseDrag`'s
 * window-level mouseup contract: listeners are attached at begin, removed on
 * the first end, and the returned teardown runs the same end path so an
 * owning row can close the gesture on unmount. Idempotent.
 *
 * The window fires pointerup once PER POINTER, so only the pointer that began
 * this gesture may end it — with two concurrent drags, one gesture's lift must
 * not end the other. The returned teardown bypasses the filter (an owning
 * row's unmount or a replacement begin ends the gesture unconditionally).
 */
function startAmountDragEndWatch(modulatorId: string, target: MappingTarget, pointerId: number): () => void {
    let ended = false;
    const handleUp = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) {
            return;
        }
        end();
    };
    const end = (): void => {
        if (ended) {
            return;
        }
        ended = true;
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        endMappingAmountDrag(modulatorId, target);
    };

    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return end;
}

const MappingRow = ({ modulator, mapping, destination }: MappingRowProps): ReactElement => {
    const amountDragEndRef = useRef<(() => void) | null>(null);
    const sourceLabel = `${modulator.name} · ${KIND_LABELS[modulator.kind]}`;
    const destinationLabel =
        destination !== null
            ? `${destination.trackName} · ${destination.deviceName} · ${destination.paramName}`
            : `${mapping.targetTrackId} · ${mapping.targetDeviceId} · ${mapping.targetParamId} (unresolved)`;

    // A drag gesture (pointer down → changes → pointer up) coalesces into one
    // store write per animation frame and one undo entry for the whole
    // gesture; a keyboard step is a complete gesture in a single change event
    // and commits synchronously — same one write, same one undo entry. The
    // active-session check is scoped to THIS mapping: another pointer dragging
    // another row runs its own independent session, and its change events must
    // commit to their own mapping rather than paint into this row's gesture.
    const target = {
        targetTrackId: mapping.targetTrackId,
        targetDeviceId: mapping.targetDeviceId,
        targetParamId: mapping.targetParamId,
    };

    // Closes a still-live drag if this row unmounts before pointerup does —
    // the rAF flush has already committed the partial amount, so the undo
    // entry must be pushed here, not left for the next begin on this mapping.
    // Same ref-held teardown contract as AutomationLaneRow's activeDragCancelRef.
    useEffect(() => {
        return () => {
            amountDragEndRef.current?.();
        };
    }, []);

    const handleAmountPointerDown = (event: ReactPointerEvent<HTMLInputElement>): void => {
        // A second pointer pressing this same slider replaces the gesture: the
        // old watch must be torn down first (running its end path, which
        // commits the replaced gesture with its undo entry) or its stray
        // pointerup would end the new gesture's session.
        amountDragEndRef.current?.();
        beginMappingAmountDrag(modulator.id, target);
        amountDragEndRef.current = startAmountDragEndWatch(modulator.id, target, event.pointerId);
    };

    const handleAmountChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const next = Number.parseFloat(event.target.value);
        if (!Number.isFinite(next)) {
            return;
        }
        if (isMappingAmountDragActive(modulator.id, target)) {
            paintMappingAmountDrag(modulator.id, target, next);
            return;
        }
        beginMappingAmountDrag(modulator.id, target);
        paintMappingAmountDrag(modulator.id, target, next);
        endMappingAmountDrag(modulator.id, target);
    };

    return (
        <tr className="border-b border-border-hairline">
            <td className="px-3 py-1.5 text-[11px] text-foreground">{sourceLabel}</td>
            <td className="px-3 py-1.5 text-[11px] text-foreground">{destinationLabel}</td>
            <td className="px-3 py-1.5">
                <Row gap={2}>
                    <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={mapping.amount}
                        onChange={handleAmountChange}
                        onPointerDown={handleAmountPointerDown}
                        className="w-28 accent-[var(--color-accent-cyan)]"
                        aria-label={`Amount for ${sourceLabel} to ${destinationLabel}`}
                    />
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        {mapping.amount.toFixed(2)}
                    </span>
                </Row>
            </td>
            <td className="px-3 py-1.5 text-right">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                        removeMapping(modulator.id, {
                            targetTrackId: mapping.targetTrackId,
                            targetDeviceId: mapping.targetDeviceId,
                            targetParamId: mapping.targetParamId,
                        })
                    }
                    aria-label="Remove mapping"
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </td>
        </tr>
    );
};

type ModulatorCardProps = {
    modulator: Modulator;
    tracks: TrackRef[];
};

const ModulatorCard = ({ modulator, tracks }: ModulatorCardProps): ReactElement => {
    const [pickerOpen, setPickerOpen] = useState(false);

    return (
        <Stack gap={1.5} className="rounded-sm border border-border-hairline bg-surface-base/50 p-2">
            <Row gap={2}>
                <DawCompactInput
                    value={modulator.name}
                    onChange={(event) => updateModulator(modulator.id, { name: event.target.value })}
                    aria-label={`Rename modulator ${modulator.id}`}
                    className="max-w-[160px]"
                />
                <span className="rounded-sm bg-surface-inset px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {KIND_LABELS[modulator.kind]}
                </span>
                <Row as="label" gap={1} className="ml-2 text-[10px] text-muted-foreground">
                    <DawCompactCheckbox
                        type="checkbox"
                        checked={modulator.enabled}
                        onChange={(event) => updateModulator(modulator.id, { enabled: event.target.checked })}
                    />
                    Enabled
                </Row>
                <div className="flex-1" />
                <Button variant="ghost" size="xs" onClick={() => setPickerOpen((open) => !open)}>
                    <Plus className="size-3" />
                    <span className="ml-1">Add Mapping</span>
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeModulator(modulator.id)}
                    aria-label={`Remove modulator ${modulator.name}`}
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </Row>
            {pickerOpen ? (
                <AddMappingPicker modulatorId={modulator.id} tracks={tracks} onClose={() => setPickerOpen(false)} />
            ) : null}
        </Stack>
    );
};

export const ModulationMatrix = (): ReactElement => {
    const modState = useStore(modulationStore, emptyModState);
    const trackState = useStore(trackStore, defaultTrackState);
    const [newFormOpen, setNewFormOpen] = useState(false);

    const tracks: TrackRef[] = trackState.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        devices: track.devices.map((device) => ({ id: device.id, name: device.name, type: device.type })),
    }));
    const modulators = modState.modulators;

    const flatRows = modulators.flatMap((modulator) =>
        modulator.mappings.map((mapping) => ({
            modulator,
            mapping,
            destination: describeDestination(tracks, mapping),
        }))
    );

    return (
        <DawPanelSurface role="region" aria-label="Modulation matrix">
            <DawHeaderBand
                className="shrink-0"
                title="Modulation"
                titleClassName="text-[11px] font-semibold text-foreground uppercase tracking-wider"
                actions={
                    <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => setNewFormOpen((open) => !open)}
                        aria-expanded={newFormOpen}
                        data-testid="modulation-new-button"
                    >
                        <Plus className="size-3" />
                        <span className="ml-1">New Modulator</span>
                    </Button>
                }
            />

            {newFormOpen ? <NewModulatorForm tracks={tracks} onClose={() => setNewFormOpen(false)} /> : null}

            <div className="flex-1 overflow-auto">
                <Stack gap={2} className="p-2">
                    {modulators.length === 0 ? (
                        <DawEmptyState
                            title="No modulators"
                            description="Create an LFO or step modulator to animate device parameters during playback."
                            className="mx-auto mt-6 max-w-sm"
                        />
                    ) : (
                        modulators.map((modulator) => (
                            <ModulatorCard key={modulator.id} modulator={modulator} tracks={tracks} />
                        ))
                    )}
                </Stack>

                {flatRows.length === 0 ? null : (
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="border-b border-border-hairline bg-surface-inset text-left">
                                <th className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Source
                                </th>
                                <th className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Destination
                                </th>
                                <th className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Amount
                                </th>
                                <th className="px-3 py-1.5 text-right text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Remove
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {flatRows.map((row) => (
                                <MappingRow
                                    key={`${row.modulator.id}:${row.mapping.targetTrackId}:${row.mapping.targetDeviceId}:${row.mapping.targetParamId}`}
                                    modulator={row.modulator}
                                    mapping={row.mapping}
                                    destination={row.destination}
                                />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </DawPanelSurface>
    );
};
