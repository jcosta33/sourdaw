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
    formatExternalPluginParameterValue as askPluginForValueText,
    hasUnresolvedExternalPluginRestoreFailure,
    isSupportedPluginFormat,
    refreshExternalPluginParameters,
} from '#/modules/PluginHost/useCases';
import { transportStore } from '#/modules/Transport/stores';
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
    row: ExternalPluginParameterRow;
    /** Writes to the list's live region, which is mounted before any edit so the text is announced. */
    onAnnounce: (message: string) => void;
};

type AnsweredValueTextInput = {
    instanceId: string;
    parameterId: number;
    value: number;
    skip: boolean;
};

// The snapshot's text describes the snapshot's value. Any other shown value (a pending edit,
// a followed lane, a value just patched in) asks the plugin, one question in flight at a time:
// the answer for a value no longer shown is dropped by the check below and the next question
// is for the value shown now. Only the latest answer is kept, so a null answer stops a repeat
// question for the value still shown, while a value shown again after another is asked again.
// A followed lane moves every frame, so it never asks; the explicit Number.isFinite check keeps a
// non-finite value from being asked.
const useAnsweredValueText = ({ instanceId, parameterId, value, skip }: AnsweredValueTextInput): string | null => {
    const [answer, setAnswer] = useState<{ value: number; text: string | null } | null>(null);
    const askingRef = useRef(false);
    useEffect(() => {
        if (skip || !Number.isFinite(value) || answer?.value === value || askingRef.current) {
            return;
        }
        askingRef.current = true;
        void (async () => {
            const text = await askPluginForValueText(instanceId, parameterId, value);
            askingRef.current = false;
            setAnswer({ value, text });
        })();
    }, [skip, answer, value, instanceId, parameterId]);
    return answer?.value === value ? answer.text : null;
};

type ParameterEditInput = Pick<ParameterRowProps, 'instanceId' | 'row' | 'onAnnounce'>;

const useParameterEdit = ({ instanceId, row, onAnnounce }: ParameterEditInput) => {
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

    return { refused, pendingValue, edit };
};

const describeBy = (descriptions: readonly { present: boolean; id: string }[]): string | undefined =>
    descriptions
        .filter((description) => description.present)
        .map((description) => description.id)
        .join(' ') || undefined;

const AutomatedMarker = ({
    automated,
    descriptionId,
}: {
    automated: boolean;
    descriptionId: string;
}): ReactElement | null => {
    if (!automated) {
        return null;
    }
    return (
        <>
            <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--color-accent-peach)]" />
            <span id={descriptionId} className="sr-only">
                Automated
            </span>
        </>
    );
};

type ParameterControlProps = {
    row: ExternalPluginParameterRow;
    value: number;
    describedBy: string | undefined;
    onEdit: (requested: number) => void;
};

const ToggleSwitch = ({ row, value, describedBy, onEdit }: ParameterControlProps): ReactElement | null => {
    if (row.kind !== 'toggle') {
        return null;
    }
    return (
        <input
            type="checkbox"
            role="switch"
            aria-label={row.name}
            aria-describedby={describedBy}
            disabled={row.readOnly}
            checked={value - row.min >= 0.5}
            aria-checked={value - row.min >= 0.5}
            onChange={(event) => onEdit(event.target.checked ? row.max : row.min)}
        />
    );
};

const RangeSlider = ({
    row,
    value,
    describedBy,
    valueText,
    onEdit,
}: ParameterControlProps & { valueText: string }): ReactElement | null => {
    if (row.kind === 'toggle') {
        return null;
    }
    return (
        <input
            type="range"
            aria-label={row.name}
            aria-describedby={describedBy}
            disabled={row.readOnly}
            aria-valuetext={valueText}
            className="w-full"
            min={row.min}
            max={row.max}
            step={row.step}
            value={value}
            onChange={(event) => onEdit(Number(event.target.value))}
        />
    );
};

const ParameterRow = ({
    instanceId,
    deviceId,
    automated,
    settledParameter,
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
    });
    const { refused, pendingValue, edit } = useParameterEdit({ instanceId, row, onAnnounce });

    const shownValue = pendingValue ?? followed.value;
    const value = shownValue ?? row.value;
    const snapshotText = value === row.value ? row.displayText : null;
    const snapshotTextIsCurrent = snapshotText !== null;
    // The visible number moves with the lane; announcing every step would flood a screen reader.
    const followingAnnounced = followed.following && pendingValue === null;
    const answeredText = useAnsweredValueText({
        instanceId,
        parameterId: row.id,
        value,
        skip: snapshotTextIsCurrent || followingAnnounced,
    });
    const valueText = snapshotText ?? answeredText ?? formatExternalPluginParameterValue(row, value);

    const readOnlyDescriptionId = useId();
    const describedBy = describeBy([
        { present: automated, id: automatedDescriptionId },
        { present: row.readOnly, id: readOnlyDescriptionId },
    ]);

    return (
        <li
            ref={rowRef}
            className="flex flex-col gap-0.5"
            data-testid={`external-parameter-${String(row.id)}`}
            data-automated={automated ? 'true' : undefined}
        >
            <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-[10px] text-foreground">{row.name}</span>
                <AutomatedMarker automated={automated} descriptionId={automatedDescriptionId} />
                {row.readOnly && (
                    <span id={readOnlyDescriptionId} className="sr-only">
                        Read-only
                    </span>
                )}
                <ToggleSwitch row={row} value={value} describedBy={describedBy} onEdit={edit} />
                <MetaText className="shrink-0 text-right tabular-nums">{valueText}</MetaText>
            </div>
            <RangeSlider
                row={row}
                value={value}
                describedBy={describedBy}
                valueText={followingAnnounced ? FOLLOWING_VALUE_TEXT : valueText}
                onEdit={edit}
            />
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

/**
 * Host-side automation writes are not echoed as edits, so the store holds the pre-play value; on each
 * stop edge (and on mount) re-read what the plugin actually holds. A patch is not an edit.
 */
const useRefreshAfterAutomatedPlayback = (
    instanceId: string | undefined,
    automatedIdsKey: string,
    isPlaying: boolean
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
        void refreshExternalPluginParameters(instanceId);
    }, [isPlaying, automatedIdsKey, instanceId]);
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
    useRefreshAfterAutomatedPlayback(instanceId, automatedIdsKey, isPlaying);

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
        buildExternalPluginParameterRows(snapshot.parameters, {
            // The host reports VST3 values normalized, so the unit does not describe the plain number
            // a plugin with no display text falls back to.
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
