import {
    type ChangeEvent,
    type DragEvent as ReactDragEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactElement,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';

import { GripVertical, Plus, Trash2, X } from 'lucide-react';

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
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';

import { type Modulator, type ModulatorKind, type ModulatorMapping } from '../../models/Modulator';
import { modulationDragPreviewStore } from '../../stores/modulationDragPreviewStore';
import { modulationStore, type ModulationStoreState } from '../../stores/modulationStore';
import { beginMappingAmountDrag } from '../../useCases/modulation/beginMappingAmountDrag';
import { endMappingAmountDrag } from '../../useCases/modulation/endMappingAmountDrag';
import { isMappingAmountDragActive } from '../../useCases/modulation/isMappingAmountDragActive';
import { paintMappingAmountDrag } from '../../useCases/modulation/paintMappingAmountDrag';
import { type MappingTarget } from '../../useCases/modulation/removeMapping';
import { useModulationSubmission } from '../hooks/useModulationSubmission';

import { AddMappingPicker, type TrackRef } from './AddMappingPicker';

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
    const fieldId = useId();

    const { error, pending, submit } = useModulationSubmission(onClose);
    const nameRef = useRef<HTMLInputElement>(null);
    const hasTrack = tracks.some((track) => track.id === form.trackId);

    useEffect(() => {
        nameRef.current?.focus();
    }, []);

    // Seed an initially empty picker after track hydration. A deleted selection
    // stays visibly unavailable until the musician chooses its replacement.
    if (form.trackId === '' && defaultTrackId !== '') {
        setForm({ ...form, trackId: defaultTrackId });
    }

    const setField = <Key extends keyof FormState>(key: Key, value: FormState[Key]): void => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmit = (): void => {
        const built = buildModulator(form);
        if (!built) {
            return;
        }
        const modulatorId = `mod-${built.kind}-${crypto.randomUUID()}`;
        void submit(
            { type: 'addModulator', payload: { modulatorId, modulator: built } },
            () => trackStore.value?.tracks.some((track) => track.id === built.trackId) === true,
            () => modulationStore.value?.modulators.some((source) => source.id === modulatorId) === true
        );
    };

    return (
        <Stack gap={2} className="w-full max-w-[40rem] p-2">
            <Row justify="between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    New Modulator
                </span>
                <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close new modulator form">
                    <X className="size-3.5" />
                </Button>
            </Row>
            <fieldset
                disabled={pending}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5"
            >
                <label htmlFor={`${fieldId}-name`} className="text-[10px] text-muted-foreground">
                    Name
                </label>
                <DawCompactInput
                    id={`${fieldId}-name`}
                    ref={nameRef}
                    value={form.name}
                    onChange={(event) => setField('name', event.target.value)}
                    aria-label="Modulator name"
                />
                <label htmlFor={`${fieldId}-kind`} className="text-[10px] text-muted-foreground">
                    Kind
                </label>
                <DawCompactSelect
                    id={`${fieldId}-kind`}
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
                <label htmlFor={`${fieldId}-track`} className="text-[10px] text-muted-foreground">
                    Track
                </label>
                <DawCompactSelect
                    id={`${fieldId}-track`}
                    value={form.trackId}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setField('trackId', event.target.value)}
                    aria-label="Modulator track scope"
                >
                    {tracks.length === 0 ? <option value="">No tracks available</option> : null}
                    {form.trackId && !hasTrack ? (
                        <option disabled value={form.trackId}>
                            Track unavailable
                        </option>
                    ) : null}
                    {tracks.map((track) => (
                        <option key={track.id} value={track.id}>
                            {track.name}
                        </option>
                    ))}
                </DawCompactSelect>

                {form.kind === 'lfo' ? (
                    <>
                        <label htmlFor={`${fieldId}-waveform`} className="text-[10px] text-muted-foreground">
                            Waveform
                        </label>
                        <DawCompactSelect
                            id={`${fieldId}-waveform`}
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
                        <label htmlFor={`${fieldId}-rate`} className="text-[10px] text-muted-foreground">
                            Rate (beats)
                        </label>
                        <DawCompactInput
                            id={`${fieldId}-rate`}
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
                        <label htmlFor={`${fieldId}-steps`} className="text-[10px] text-muted-foreground">
                            Steps
                        </label>
                        <DawCompactInput
                            id={`${fieldId}-steps`}
                            type="number"
                            min="1"
                            max="64"
                            step="1"
                            value={form.stepCount}
                            onChange={(event) => setField('stepCount', event.target.value)}
                        />
                    </>
                ) : null}
            </fieldset>
            {!hasTrack ? (
                <p className="text-xs text-muted-foreground">Choose an available track to add a modulator.</p>
            ) : null}
            {error ? (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            ) : null}
            <Row justify="end" gap={2} className="pt-1">
                <Button variant="ghost" size="xs" onClick={onClose}>
                    Cancel
                </Button>
                <Button variant="secondary" size="xs" onClick={handleSubmit} disabled={pending || !hasTrack}>
                    <Plus className="size-3" />
                    <span className="ml-1">Add</span>
                </Button>
            </Row>
        </Stack>
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
                        void executeUserAppAction({
                            type: 'removeMapping',
                            payload: {
                                modulatorId: modulator.id,
                                target: {
                                    targetTrackId: mapping.targetTrackId,
                                    targetDeviceId: mapping.targetDeviceId,
                                    targetParamId: mapping.targetParamId,
                                },
                            },
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
    const mappingButtonRef = useRef<HTMLButtonElement>(null);
    const closePicker = () => {
        setPickerOpen(false);
        mappingButtonRef.current?.focus();
    };

    useEffect(() => {
        const clearOwnedDrag = (): void => {
            if (modulationDragPreviewStore.value?.modulatorId === modulator.id) {
                modulationDragPreviewStore.set({ modulatorId: null, projectAuthority: null });
            }
        };
        const cancelOnEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                clearOwnedDrag();
            }
        };
        window.addEventListener('keydown', cancelOnEscape);
        window.addEventListener('blur', clearOwnedDrag);
        return () => {
            window.removeEventListener('keydown', cancelOnEscape);
            window.removeEventListener('blur', clearOwnedDrag);
            clearOwnedDrag();
        };
    }, [modulator.id]);

    const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>): void => {
        const projectAuthority = captureProjectTransitionAuthority();
        event.dataTransfer.setData('application/x-sourdaw-modulator', modulator.id);
        event.dataTransfer.effectAllowed = 'copy';
        modulationDragPreviewStore.set({ modulatorId: modulator.id, projectAuthority });
    };

    const handleDragEnd = (): void => {
        if (modulationDragPreviewStore.value?.modulatorId === modulator.id) {
            modulationDragPreviewStore.set({ modulatorId: null, projectAuthority: null });
        }
    };

    return (
        <Stack gap={1.5} className="rounded-sm border border-border-hairline bg-surface-base/50 p-2">
            <Row gap={2}>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    draggable={modulator.enabled}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    aria-label={`Drag modulator ${modulator.name} to a parameter`}
                    title="Drag to a device parameter"
                    className="cursor-grab disabled:cursor-not-allowed"
                    disabled={!modulator.enabled}
                >
                    <GripVertical className="size-3.5" />
                </Button>
                <DawCompactInput
                    value={modulator.name}
                    onChange={(event) =>
                        void executeUserAppAction({
                            type: 'updateModulator',
                            payload: { modulatorId: modulator.id, patch: { name: event.target.value } },
                        })
                    }
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
                        onChange={(event) =>
                            void executeUserAppAction({
                                type: 'updateModulator',
                                payload: { modulatorId: modulator.id, patch: { enabled: event.target.checked } },
                            })
                        }
                    />
                    Enabled
                </Row>
                <div className="flex-1" />
                <Button
                    ref={mappingButtonRef}
                    variant="ghost"
                    size="xs"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((open) => !open)}
                >
                    <Plus className="size-3" />
                    <span className="ml-1">Add Mapping</span>
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                        void executeUserAppAction({ type: 'removeModulator', payload: { modulatorId: modulator.id } })
                    }
                    aria-label={`Remove modulator ${modulator.name}`}
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </Row>
            {pickerOpen ? <AddMappingPicker modulator={modulator} tracks={tracks} onClose={closePicker} /> : null}
        </Stack>
    );
};

export const ModulationMatrix = (): ReactElement => {
    const modState = useStore(modulationStore, emptyModState);
    const trackState = useStore(trackStore, defaultTrackState);
    const [newFormOpen, setNewFormOpen] = useState(false);
    const newButtonRef = useRef<HTMLButtonElement>(null);
    const closeForm = () => {
        setNewFormOpen(false);
        newButtonRef.current?.focus();
    };

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
                        ref={newButtonRef}
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

            {newFormOpen ? (
                <section
                    aria-label="New modulator form"
                    className="max-h-[55%] min-h-0 shrink-0 overflow-auto overscroll-contain border-b border-border-hairline bg-surface-inset"
                >
                    <NewModulatorForm tracks={tracks} onClose={closeForm} />
                </section>
            ) : null}

            <section aria-label="Modulators and mappings" className="min-h-0 flex-1 overflow-auto overscroll-contain">
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
            </section>
        </DawPanelSurface>
    );
};
