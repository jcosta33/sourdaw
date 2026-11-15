import { type ReactElement, useEffect, useRef, useState } from 'react';

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
    /** Writes to the list's live region, which is mounted before any edit so the text is announced. */
    onAnnounce: (message: string) => void;
};

const ParameterRow = ({ instanceId, row, onAnnounce }: ParameterRowProps): ReactElement => {
    const [refused, setRefused] = useState(false);
    // The store moves only once the plugin accepts a change, so while the latest send is in flight the
    // row holds the value it asked for; otherwise a second nudge would start from the stale store value.
    const [pendingValue, setPendingValue] = useState<number | null>(null);
    const latestSendRef = useRef(0);

    const sendEdit = async (requested: number, send: number): Promise<void> => {
        try {
            await editExternalPluginParameter({ instanceId, parameterId: row.id, value: requested });
        } catch {
            if (latestSendRef.current === send) {
                setPendingValue(null);
                setRefused(true);
                onAnnounce(`${row.name}: ${REFUSED_MESSAGE}`);
            }
            return;
        }
        if (latestSendRef.current === send) {
            setPendingValue(null);
        }
    };

    const edit = (requested: number): void => {
        const send = ++latestSendRef.current;
        setRefused(false);
        onAnnounce('');
        setPendingValue(requested);
        void sendEdit(requested, send);
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
                        aria-checked={value - row.min >= 0.5}
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
            {refused && <span className="text-[10px] text-destructive">{REFUSED_MESSAGE}</span>}
        </li>
    );
};

/**
 * The marker is read from plain module memory, which React's compiler cannot see change, so the
 * caller keys this by the marker store's version: a mark or clear remounts it and re-reads the marker.
 */
const RestoreFailureNotice = ({ instanceId }: { instanceId: string }): ReactElement | null => {
    if (!hasUnresolvedExternalPluginRestoreFailure(instanceId)) {
        return null;
    }
    return (
        <div role="status">
            <MetaText>
                This plugin&apos;s saved state could not be restored. Changes made here will not be saved with the
                project until its saved state is replaced.
            </MetaText>
        </div>
    );
};

export const ExternalPluginParameterList = ({ device }: ExternalPluginParameterListProps): ReactElement => {
    const scanState = useStore(pluginScanStore, defaultPluginScanState);
    const activationState = useStore(externalPluginActivationStore, defaultExternalPluginActivationState);
    const parameterState = useStore(externalPluginParameterStore, defaultExternalPluginParameterState);
    // The marker set is plain module memory; the store's version is the render signal for it.
    const restoreFailure = useStore(externalPluginRestoreFailureStore, defaultExternalPluginRestoreFailureState);
    const [query, setQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [announcement, setAnnouncement] = useState('');
    const listRef = useRef<HTMLUListElement>(null);
    const focusIndexAfterRevealRef = useRef<number | null>(null);

    // Revealing a page can unmount the focused Show more button; move focus to the first revealed control.
    useEffect(() => {
        const index = focusIndexAfterRevealRef.current;
        if (index === null) {
            return;
        }
        focusIndexAfterRevealRef.current = null;
        listRef.current?.children[index]?.querySelector<HTMLElement>('input')?.focus();
    }, [visibleCount]);

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
            <RestoreFailureNotice key={restoreFailure.version} instanceId={instanceId} />
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
            <div role="status" className="sr-only" data-testid="parameter-announcements">
                {announcement}
            </div>
            <ul ref={listRef} className="flex flex-col gap-1.5" aria-label="Plugin parameters">
                {shown.map((row) => (
                    <ParameterRow key={row.id} instanceId={instanceId} row={row} onAnnounce={setAnnouncement} />
                ))}
            </ul>
            {shown.length < rows.length && (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="self-start"
                    onClick={() => {
                        focusIndexAfterRevealRef.current = shown.length;
                        setVisibleCount(visibleCount + PAGE_SIZE);
                    }}
                >
                    Show more
                </Button>
            )}
        </Stack>
    );
};
