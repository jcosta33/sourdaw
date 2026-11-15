import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { DawSearchInput } from '#/components/daw/DawSearchInput';
import { Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { type AutomationStoreState, automationStore } from '#/modules/Automation/stores';
import {
    defaultExternalPluginActivationState,
    defaultExternalPluginParameterState,
    defaultExternalPluginRestoreFailureState,
    defaultPluginScanState,
    externalPluginActivationStore,
    type ExternalPluginParameter,
    externalPluginParameterStore,
    externalPluginRestoreFailureStore,
    pluginScanStore,
} from '#/modules/PluginHost/stores';
import {
    editExternalPluginParameter,
    hasUnresolvedExternalPluginRestoreFailure,
    isSupportedPluginFormat,
    refreshExternalPluginParameters,
} from '#/modules/PluginHost/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { readLatestAutomationWriteSequence } from '#/modules/Transport/useCases';
import { getDeviceAutomationOwnerId, getDeviceAutomationParameterId } from '#/utils/automationDeviceTarget';

import { type Device } from '../../../models/TrackViewTypes';
import { MetaText } from '../../components/Inspector/MetaText';
import {
    buildExternalPluginParameterRows,
    type ExternalPluginParameterRow,
    filterExternalPluginParameterRows,
    formatExternalPluginParameterValue,
    resolveExternalPluginParameterStatus,
} from '../../helpers/externalPluginParameterRows';
import { useFollowedAutomationValue } from '../../hooks/useFollowedAutomationValue';

const PAGE_SIZE = 50;
const REFUSED_MESSAGE = 'The plugin refused this change.';
const FOLLOWING_VALUE_TEXT = 'Following automation';

/** Sorted, comma-joined plugin parameter ids that any lane on this device, track-level or clip-level, drives. */
function selectAutomatedIdsKey(state: AutomationStoreState | null, deviceId: string): string {
    const ids = new Set<number>();
    for (const lane of state?.lanes ?? []) {
        if (getDeviceAutomationOwnerId(lane.parameterId) !== deviceId) {
            continue;
        }
        const parameterId = Number(getDeviceAutomationParameterId(lane.parameterId));
        if (Number.isInteger(parameterId)) {
            ids.add(parameterId);
        }
    }
    return [...ids].sort((a, b) => a - b).join(',');
}

function parseAutomatedIdsKey(key: string): ReadonlySet<number> {
    return new Set(key === '' ? [] : key.split(',').map(Number));
}

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
    deviceId: string;
    automated: boolean;
    /** The parameter's own store object; a patch to this parameter replaces it. */
    settledParameter: ExternalPluginParameter | undefined;
    /** Which scheduler write was latest when the re-read that produced a parameter object was issued. */
    readIssuedAt: WeakMap<object, number>;
    row: ExternalPluginParameterRow;
    /** Writes to the list's live region, which is mounted before any edit so the text is announced. */
    onAnnounce: (message: string) => void;
};

const ParameterRow = ({
    instanceId,
    deviceId,
    automated,
    settledParameter,
    readIssuedAt,
    row,
    onAnnounce,
}: ParameterRowProps): ReactElement => {
    const rowRef = useRef<HTMLLIElement>(null);
    const automatedDescriptionId = useId();
    const followed = useFollowedAutomationValue({
        deviceId,
        parameterId: row.id,
        automated,
        element: rowRef,
        settledToken: settledParameter,
        readIssuedAt,
    });
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

    const shownValue = pendingValue ?? followed.value;
    const value = shownValue ?? row.value;
    const valueText = shownValue === null ? row.valueText : formatExternalPluginParameterValue(row, shownValue);
    // The visible number moves with the lane; announcing every step would flood a screen reader.
    const followingAnnounced = followed.following && pendingValue === null;
    const describedBy = automated ? automatedDescriptionId : undefined;

    return (
        <li
            ref={rowRef}
            className="flex flex-col gap-0.5"
            data-testid={`external-parameter-${String(row.id)}`}
            data-automated={automated ? 'true' : undefined}
        >
            <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-[10px] text-foreground">{row.name}</span>
                {automated && (
                    <>
                        <span
                            aria-hidden="true"
                            className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--color-accent-peach)]"
                        />
                        <span id={automatedDescriptionId} className="sr-only">
                            Automated
                        </span>
                    </>
                )}
                {row.kind === 'toggle' && (
                    <input
                        type="checkbox"
                        role="switch"
                        aria-label={row.name}
                        aria-describedby={describedBy}
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
                    aria-describedby={describedBy}
                    aria-valuetext={followingAnnounced ? FOLLOWING_VALUE_TEXT : valueText}
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

const currentParameters = (instanceId: string): readonly ExternalPluginParameter[] =>
    externalPluginParameterStore.value?.byInstanceId[instanceId]?.parameters ?? [];

/**
 * Re-reads the host and records, for each parameter object the re-read published, the scheduler write
 * that was latest when it was issued: the answer can predate a write that lands while the host replies.
 */
async function refreshAndTag(instanceId: string, readIssuedAt: WeakMap<object, number>): Promise<void> {
    const issuedAt = readLatestAutomationWriteSequence();
    const before = new Set<object>(currentParameters(instanceId));
    await refreshExternalPluginParameters(instanceId);
    for (const parameter of currentParameters(instanceId)) {
        if (!before.has(parameter)) {
            readIssuedAt.set(parameter, issuedAt);
        }
    }
}

/**
 * Host-side automation writes are not echoed as edits, so the store holds the pre-play value; on each
 * stop edge (and on mount) re-read what the plugin actually holds. A patch is not an edit.
 */
const useRefreshAfterAutomatedPlayback = (
    instanceId: string | undefined,
    automatedIdsKey: string,
    isPlaying: boolean,
    readIssuedAt: WeakMap<object, number>
): void => {
    const hadAutomationRef = useRef(false);
    useEffect(() => {
        if (automatedIdsKey !== '') {
            hadAutomationRef.current = true;
        }
        if (isPlaying || !instanceId) {
            return;
        }
        // A list that never had automation has nothing the host could have moved; losing the last lane
        // still re-reads, because the row holds a followed value the store does not have.
        if (automatedIdsKey === '' && !hadAutomationRef.current) {
            return;
        }
        void refreshAndTag(instanceId, readIssuedAt);
    }, [isPlaying, automatedIdsKey, instanceId, readIssuedAt]);
};

export const ExternalPluginParameterList = ({ device }: ExternalPluginParameterListProps): ReactElement => {
    const scanState = useStore(pluginScanStore, defaultPluginScanState);
    const activationState = useStore(externalPluginActivationStore, defaultExternalPluginActivationState);
    const parameterState = useStore(externalPluginParameterStore, defaultExternalPluginParameterState);
    // The marker set is plain module memory; the store's version is the render signal for it.
    const restoreFailure = useStore(externalPluginRestoreFailureStore, defaultExternalPluginRestoreFailureState);
    const automatedIdsKey = useStoreSelector(automationStore, (state) => selectAutomatedIdsKey(state, device.id));
    const isPlaying = useStoreSelector(transportStore, (state) => state?.isPlaying ?? false);
    const [query, setQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [announcement, setAnnouncement] = useState('');
    const listRef = useRef<HTMLUListElement>(null);
    const focusIndexAfterRevealRef = useRef<number | null>(null);
    const [readIssuedAt] = useState(() => new WeakMap<object, number>());

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
    const automatedParameterIds = parseAutomatedIdsKey(automatedIdsKey);
    useRefreshAfterAutomatedPlayback(instanceId, automatedIdsKey, isPlaying, readIssuedAt);

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
    const settledById = new Map(snapshot.parameters.map((parameter) => [parameter.id, parameter]));

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
                    <ParameterRow
                        key={row.id}
                        instanceId={instanceId}
                        deviceId={device.id}
                        automated={automatedParameterIds.has(row.id)}
                        settledParameter={settledById.get(row.id)}
                        readIssuedAt={readIssuedAt}
                        row={row}
                        onAnnounce={setAnnouncement}
                    />
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
