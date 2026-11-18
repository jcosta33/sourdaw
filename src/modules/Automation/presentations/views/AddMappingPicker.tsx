import { type ChangeEvent, type ReactElement, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { trackStore } from '#/modules/Arrangement/stores';
import { getPluginById } from '#/modules/Arrangement/useCases';

import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';
import { useModulationSubmission } from '../hooks/useModulationSubmission';

type DeviceRef = {
    id: string;
    name: string;
    type: string;
};

export type TrackRef = {
    id: string;
    name: string;
    devices: DeviceRef[];
};

type AddMappingPickerProps = {
    modulator: Modulator;
    tracks: TrackRef[];
    onClose: () => void;
};

type MappingTargetFieldProps = {
    label: 'Track' | 'Device' | 'Parameter';
    options: { id: string; name: string }[];
    emptyLabel: string;
    value: string;
    disabled: boolean;
    onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
};

function MappingTargetField({
    label,
    options,
    emptyLabel,
    value,
    disabled,
    onChange,
}: MappingTargetFieldProps): ReactElement {
    return (
        <label className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            {label}
            <DawCompactSelect
                value={value}
                onChange={onChange}
                aria-label={`Target ${label.toLowerCase()}`}
                disabled={disabled}
            >
                {options.length === 0 ? <option value="">{emptyLabel}</option> : null}
                {options.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.name}
                    </option>
                ))}
            </DawCompactSelect>
        </label>
    );
}

function firstAutomatableParameterId(device: DeviceRef | undefined): string {
    const descriptor = device ? getPluginById(device.type) : undefined;
    return descriptor?.parameters.find((parameter) => parameter.automatable)?.id ?? '';
}

export const AddMappingPicker = ({ modulator, tracks, onClose }: AddMappingPickerProps): ReactElement => {
    const modulatorId = modulator.id;
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
        const nextDevice = nextTrack?.devices[0];
        setDeviceId(nextDevice?.id ?? '');
        setParamId(firstAutomatableParameterId(nextDevice));
    };

    const handleDeviceChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextDeviceId = event.target.value;
        setDeviceId(nextDeviceId);
        const nextDevice = selectedTrack?.devices.find((d) => d.id === nextDeviceId);
        setParamId(firstAutomatableParameterId(nextDevice));
    };

    const { error, pending, submit } = useModulationSubmission(onClose);
    const canAdd = automatable.some((param) => param.id === paramId);

    const selectedDestination = (source: Modulator | undefined) =>
        source?.mappings.find(
            (mapping) =>
                mapping.targetTrackId === trackId &&
                mapping.targetDeviceId === deviceId &&
                mapping.targetParamId === paramId
        );
    const existingMapping = selectedDestination(modulator);
    const handleAdd = (): void => {
        const mapping = { targetTrackId: trackId, targetDeviceId: deviceId, targetParamId: paramId, amount: 0.5 };
        const source = () => modulationStore.value?.modulators.find((modulator) => modulator.id === modulatorId);
        const hasTarget = () => {
            const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
            const device = track?.devices.find((candidate) => candidate.id === deviceId);
            return Boolean(
                source() &&
                device &&
                getPluginById(device.type)?.parameters.some((p) => p.id === paramId && p.automatable)
            );
        };
        void submit(
            { type: 'addMapping', payload: { modulatorId, mapping } },
            hasTarget,
            () => selectedDestination(source()) !== undefined
        );
    };

    return (
        <Row wrap gap={2} className="rounded-sm bg-surface-inset px-2 py-1.5">
            <MappingTargetField
                label="Track"
                options={tracks}
                emptyLabel="No tracks"
                value={trackId}
                disabled={pending}
                onChange={handleTrackChange}
            />
            <MappingTargetField
                label="Device"
                options={selectedTrack?.devices ?? []}
                emptyLabel="No devices"
                value={deviceId}
                disabled={pending || !selectedTrack || selectedTrack.devices.length === 0}
                onChange={handleDeviceChange}
            />
            <MappingTargetField
                label="Parameter"
                options={automatable}
                emptyLabel="No automatable params"
                value={paramId}
                disabled={pending || automatable.length === 0}
                onChange={(event) => setParamId(event.target.value)}
            />
            <Button variant="secondary" size="xs" onClick={handleAdd} disabled={pending || !canAdd}>
                Add
            </Button>
            <Button variant="ghost" size="xs" onClick={onClose}>
                Cancel
            </Button>
            {existingMapping ? (
                <p role="status" className="text-xs text-muted-foreground">
                    Already mapped at {existingMapping.amount.toFixed(2)}. Adjust Amount in the mappings list.
                </p>
            ) : null}
            {error ? (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            ) : null}
        </Row>
    );
};
