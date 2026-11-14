import { type ReactElement, useRef, useState } from 'react';

import { DawSearchInput } from '#/components/daw/DawSearchInput';
import { Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
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
    formatExternalPluginParameterValue,
    resolveExternalPluginParameterStatus,
} from '../../helpers/externalPluginParameterRows';

const PAGE_SIZE = 50;
const REFUSED_MESSAGE = 'The plugin refused this change.';

function pluralParameters(count: number): string {
    return count === 1 ? '1 parameter' : `${String(count)} parameters`;
}

function describeCount(shown: number, total: number): string {
    if (shown === total) {
        return pluralParameters(total);
    }
    return `${String(shown)} of ${pluralParameters(total)}`;
}

type ExternalPluginParameterListProps = {
    device: Device;
};

type ParameterRowProps = {
    instanceId: string;
    row: ExternalPluginParameterRow;
};

const ParameterRow = ({ instanceId, row }: ParameterRowProps): ReactElement => {
    const [refused, setRefused] = useState(false);
    // The store moves only once the plugin accepts a change, so while the latest send is in flight the
    // row holds the value it asked for; otherwise a second nudge would start from the stale store value.
    const [pendingValue, setPendingValue] = useState<number | null>(null);
    const latestSend = useRef(0);

    const edit = (requested: number): void => {
        const send = ++latestSend.current;
        setRefused(false);
        setPendingValue(requested);
        editExternalPluginParameter({ instanceId, parameterId: row.id, value: requested })
            .then(() => {
                if (latestSend.current === send) {
                    setPendingValue(null);
                }
            })
            .catch(() => {
                if (latestSend.current === send) {
                    setPendingValue(null);
                    setRefused(true);
                }
            });
    };

    const value = pendingValue ?? row.value;
    const valueText = pendingValue === null ? row.valueText : formatExternalPluginParameterValue(row, pendingValue);

    return (
        <li className="flex flex-col gap-0.5" data-testid={`external-parameter-${String(row.id)}`}>
            <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-[10px] text-foreground">{row.name}</span>
                {row.kind === 'toggle' && (
                    <input
                        type="checkbox"
                        role="switch"
                        aria-label={row.name}
                        checked={value - row.min >= 0.5}
                        onChange={(event) => edit(event.target.checked ? row.max : row.min)}
                    />
                )}
                <MetaText className="shrink-0 text-right tabular-nums">{valueText}</MetaText>
            </div>
            {row.kind !== 'toggle' && (
                <input
                    type="range"
                    aria-label={row.name}
                    aria-valuetext={valueText}
                    className="w-full"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={value}
                    onChange={(event) => edit(Number(event.target.value))}
                />
            )}
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
        buildExternalPluginParameterRows(snapshot.parameters, scanned?.parameters, {
            // The host reports VST3 values normalized, so the unit does not describe the number; #6579
            // tracks showing the plugin's own display text.
            valuesAreNormalized: scanned?.format.toLowerCase() === 'vst3',
        }),
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
                <MetaText>{describeCount(rows.length, snapshot.parameters.length)}</MetaText>
            </div>
            <ul className="flex flex-col gap-1.5" aria-label="Plugin parameters">
                {shown.map((row) => (
                    <ParameterRow key={row.id} instanceId={instanceId} row={row} />
                ))}
            </ul>
            {shown.length < rows.length && (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="self-start"
                    onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
                >
                    Show more
                </Button>
            )}
        </Stack>
    );
};
