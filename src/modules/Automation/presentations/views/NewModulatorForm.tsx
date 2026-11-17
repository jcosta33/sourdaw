import { type ChangeEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { Plus, X } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { trackStore } from '#/modules/Arrangement/stores';

import { type Modulator, type ModulatorKind } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';
import { useModulationSubmission } from '../hooks/useModulationSubmission';

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
    tracks: { id: string; name: string }[];
    onClose: () => void;
};

type TrackScopeFieldProps = {
    fieldId: string;
    tracks: NewModulatorFormProps['tracks'];
    trackId: string;
    hasTrack: boolean;
    onChange: (trackId: string) => void;
};

function TrackScopeField({ fieldId, tracks, trackId, hasTrack, onChange }: TrackScopeFieldProps): ReactElement {
    return (
        <>
            <label htmlFor={fieldId} className="text-[10px] text-muted-foreground">
                Track
            </label>
            <DawCompactSelect
                id={fieldId}
                value={trackId}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
                aria-label="Modulator track scope"
            >
                {tracks.length === 0 ? <option value="">No tracks available</option> : null}
                {trackId && !hasTrack ? (
                    <option disabled value={trackId}>
                        Track unavailable
                    </option>
                ) : null}
                {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                        {track.name}
                    </option>
                ))}
            </DawCompactSelect>
        </>
    );
}

type SourceSettingsProps = {
    fieldId: string;
    form: FormState;
    setField: <Key extends keyof FormState>(key: Key, value: FormState[Key]) => void;
};

function SourceSettings({ fieldId, form, setField }: SourceSettingsProps): ReactElement {
    return (
        <>
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
        </>
    );
}

export const NewModulatorForm = ({ tracks, onClose }: NewModulatorFormProps): ReactElement => {
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
                <TrackScopeField
                    fieldId={`${fieldId}-track`}
                    tracks={tracks}
                    trackId={form.trackId}
                    hasTrack={hasTrack}
                    onChange={(trackId) => setField('trackId', trackId)}
                />
                <SourceSettings fieldId={fieldId} form={form} setField={setField} />
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
