import { type ReactElement, useState } from 'react';

import { DawSearchInput } from '#/components/daw/DawSearchInput';
import { Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import {
    defaultExternalPluginActivationState,
    defaultExternalPluginParameterState,
    defaultExternalPluginRestoreFailureState,
    defaultPluginScanState,
    externalPluginActivationStore,
    externalPluginParameterStore,
    externalPluginRestoreFailureStore,
    pluginScanStore,
} from '#/modules/PluginHost/stores';
import {
    editExternalPluginParameter,
    hasUnresolvedExternalPluginRestoreFailure,
    isSupportedPluginFormat,
} from '#/modules/PluginHost/useCases';

import { type Device } from '../../../models/TrackViewTypes';
import { MetaText } from '../../components/Inspector/MetaText';
import {
    buildExternalPluginParameterRows,
    type ExternalPluginParameterRow,
    filterExternalPluginParameterRows,
    resolveExternalPluginParameterStatus,
} from '../../helpers/externalPluginParameterRows';

const PAGE_SIZE = 50;
const REFUSED_MESSAGE = 'The plugin refused this change.';

type ExternalPluginParameterListProps = {
    device: Device;
};

type ParameterRowProps = {
    instanceId: string;
    row: ExternalPluginParameterRow;
};

const ParameterRow = ({ instanceId, row }: ParameterRowProps): ReactElement => {
    const [refused, setRefused] = useState(false);

    const edit = (value: number): void => {
        setRefused(false);
        editExternalPluginParameter({ instanceId, parameterId: row.id, value }).catch(() => {
            setRefused(true);
        });
    };

    return (
        <li className="flex flex-col gap-0.5" data-testid={`external-parameter-${String(row.id)}`}>
            <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[10px] text-foreground" title={row.name}>
                    {row.name}
                </span>
                {row.kind === 'toggle' ? (
                    <input
                        type="checkbox"
                        role="switch"
                        aria-label={row.name}
                        checked={row.value - row.min >= 0.5}
                        onChange={(event) => edit(event.target.checked ? row.max : row.min)}
                    />
                ) : (
                    <input
                        type="range"
                        aria-label={row.name}
                        aria-valuetext={row.valueText}
                        className="min-w-0 flex-1"
                        min={row.min}
                        max={row.max}
                        step={row.step}
                        value={row.value}
                        onChange={(event) => edit(Number(event.target.value))}
                    />
                )}
                <MetaText className="w-16 shrink-0 text-right tabular-nums">{row.valueText}</MetaText>
            </div>
            {refused && (
                <span role="status" className="text-[10px] text-destructive">
                    {REFUSED_MESSAGE}
                </span>
            )}
        </li>
    );
};

export const ExternalPluginParameterList = ({ device }: ExternalPluginParameterListProps): ReactElement => {
    const scanState = useStore(pluginScanStore, defaultPluginScanState);
    const activationState = useStore(externalPluginActivationStore, defaultExternalPluginActivationState);
    const parameterState = useStore(externalPluginParameterStore, defaultExternalPluginParameterState);
    // The marker set is plain module memory; the store's version is the render signal for it.
    useStore(externalPluginRestoreFailureStore, defaultExternalPluginRestoreFailureState);
    const [query, setQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    const instanceId = device.externalInstanceId;
    const scanned = scanState.scannedPlugins
        .filter((plugin) => isSupportedPluginFormat(plugin.format))
        .find((plugin) => plugin.id === device.externalPluginId || plugin.descriptor_id === device.externalPluginId);
    const snapshot = instanceId ? parameterState.byInstanceId[instanceId] : undefined;

    const status = resolveExternalPluginParameterStatus({
        device,
        pluginSupported: scanned !== undefined,
        activation: instanceId ? activationState.byInstanceId[instanceId] : undefined,
        parameterCount: snapshot?.parameters.length,
    });

    if (status.kind !== 'list' || !instanceId || !snapshot) {
        return (
            <div className="px-1" role="status">
                <MetaText>{status.kind === 'list' ? '' : status.message}</MetaText>
            </div>
        );
    }

    const rows = filterExternalPluginParameterRows(
        buildExternalPluginParameterRows(snapshot.parameters, scanned?.parameters),
        query
    );
    const shown = rows.slice(0, visibleCount);

    const changeQuery = (next: string): void => {
        setQuery(next);
        setVisibleCount(PAGE_SIZE);
    };

    return (
        <Stack gap={2} className="px-1" data-testid="external-plugin-parameters">
            {hasUnresolvedExternalPluginRestoreFailure(instanceId) && (
                <div role="status">
                    <MetaText>
                        This plugin&apos;s saved state could not be restored. Changes made here will not be saved with
                        the project until its saved state is replaced.
                    </MetaText>
                </div>
            )}
            <DawSearchInput
                value={query}
                onChange={changeQuery}
                size="micro"
                placeholder="Filter parameters"
                aria-label="Filter parameters"
            />
            <div role="status">
                <MetaText>
                    {rows.length === snapshot.parameters.length
                        ? `${String(rows.length)} parameters`
                        : `${String(rows.length)} of ${String(snapshot.parameters.length)} parameters`}
                </MetaText>
            </div>
            <ul className="flex flex-col gap-1.5" aria-label="Plugin parameters">
                {shown.map((row) => (
                    <ParameterRow key={row.id} instanceId={instanceId} row={row} />
                ))}
            </ul>
            {shown.length < rows.length && (
                <button
                    type="button"
                    className="self-start rounded border border-border/40 px-2 py-0.5 text-[10px] text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
                >
                    Show more
                </button>
            )}
        </Stack>
    );
};
