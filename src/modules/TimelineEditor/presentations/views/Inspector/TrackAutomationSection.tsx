import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { useStore } from '#/infra/store/useStore';
import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { toggleAutomationVisibility, removeAutomationLane } from '#/modules/Automation/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { externalPluginParameterStore, defaultExternalPluginParameterState } from '#/modules/PluginHost/stores';
import { refreshExternalPluginParameters } from '#/modules/PluginHost/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { createDeviceAutomationTargetId } from '#/utils/automationDeviceTarget';

import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';
import { findEquivalentAutomationLane } from '../../helpers/automationViewHelpers';

type TrackAutomationSectionProps = {
    track: Track;
};

type TrackAutomationState = {
    lanes: Array<{
        id: string;
        trackId: string;
        clipId?: string;
        parameterId: string;
        parameterName: string;
        visible: boolean;
    }>;
};

function existingLane(parameterId: string, lanes: TrackAutomationState['lanes'], track: Track) {
    const exact = lanes.find((lane) => lane.parameterId === parameterId);
    if (exact || parameterId === 'gain' || parameterId === 'pan') {
        return exact;
    }
    return findEquivalentAutomationLane(parameterId, lanes, track.devices, track.id);
}

const TrackAutomation = ({ track }: TrackAutomationSectionProps): ReactElement => {
    const [menuAuthority, setMenuAuthority] = useState<ReturnType<typeof captureProjectTransitionAuthority> | null>(
        null
    );
    const showAutoMenu = menuAuthority !== null;
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [addedLaneId, setAddedLaneId] = useState<string | null>(null);
    const addedLaneLabel = useRef<HTMLSpanElement>(null);

    const autoState = useStore<TrackAutomationState>(automationStore, { lanes: [] });
    // External plugin parameters resolve out of this store, and a refresh fills
    // it asynchronously. Subscribing is what redraws the menu when one lands.
    useStore(externalPluginParameterStore, defaultExternalPluginParameterState);

    const trackLanes = autoState.lanes.filter((lane) => lane.trackId === track.id && !lane.clipId);

    useEffect(() => {
        addedLaneLabel.current?.scrollIntoView({ block: 'nearest' });
    }, [addedLaneId]);

    const addLane = async (parameterId: string, parameterName: string): Promise<void> => {
        if (!menuAuthority || pending) {
            return;
        }
        setMenuAuthority(null);
        setPending(true);
        setError('');
        const laneId = `auto-${crypto.randomUUID()}`;
        const currentLanes = () =>
            (automationStore.value?.lanes ?? []).filter((lane) => lane.trackId === track.id && !lane.clipId);
        const canAdd = () =>
            menuAuthority.isCurrent() &&
            !existingLane(
                parameterId,
                currentLanes().filter((lane) => lane.id !== laneId),
                track
            );
        try {
            await executeUserAppAction(
                { type: 'addAutomationLane', payload: { trackId: track.id, parameterId, parameterName, laneId } },
                { shouldExecute: canAdd, shouldCommit: canAdd }
            );
            const settled = menuAuthority.isCurrent() && existingLane(parameterId, currentLanes(), track);
            if (settled) {
                setAddedLaneId(settled.id);
            } else {
                setError(`Could not add ${parameterName}. Check the target and project locks, then try again.`);
            }
        } catch (cause) {
            const reason = cause instanceof Error ? cause.message : 'The edit failed.';
            setError(`Could not add ${parameterName}. ${reason} Check the target and try again.`);
        } finally {
            setPending(false);
        }
    };

    const parameterButton = (parameterId: string, label: string, parameterName = label) => {
        const existing = existingLane(parameterId, trackLanes, track);
        return (
            <Button
                key={parameterId}
                variant="bare"
                size="bare"
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-start gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent/50"
                disabled={Boolean(existing) || pending}
                onClick={() => void addLane(parameterId, parameterName)}
            >
                <span className="min-w-0 whitespace-normal">{label}</span>
                {existing ? (
                    <span className="ml-auto text-[9px] text-muted-foreground" title={existing.parameterName}>
                        Existing lane
                    </span>
                ) : null}
            </Button>
        );
    };

    // Opening the menu is the moment the metadata has to be current: a plugin
    // can rename or rescale its parameters from inside its own editor window,
    // and the snapshot taken at load would keep offering the old ones.
    useEffect(() => {
        if (!showAutoMenu) {
            return;
        }
        for (const device of track.devices) {
            if (device.externalInstanceId !== undefined) {
                void refreshExternalPluginParameters(device.externalInstanceId);
            }
        }
    }, [showAutoMenu, track.devices]);

    return (
        <div className="overflow-visible">
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Automation"
                actions={
                    <Popover
                        open={showAutoMenu}
                        onOpenChange={(open) => setMenuAuthority(open ? captureProjectTransitionAuthority() : null)}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Add automation lane"
                                aria-haspopup="menu"
                                data-testid="add-automation-button"
                            >
                                <Plus className="size-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            sideOffset={4}
                            role="menu"
                            aria-label="Add automation lane"
                            className="daw-floating-surface w-48 p-0 py-1 rounded-md"
                        >
                            <DawMenuSectionLabel>Track</DawMenuSectionLabel>
                            {parameterButton('gain', 'Gain')}
                            {parameterButton('pan', 'Pan')}
                            {track.devices.length > 0 ? (
                                <>
                                    <DawMenuSeparator />
                                    {track.devices.map((device) => {
                                        const plugin = getAutomationDeviceDescriptor(
                                            device.type,
                                            device.externalInstanceId
                                        );
                                        if (!plugin) {
                                            return null;
                                        }
                                        const autoParams = plugin.parameters.filter((param) => param.automatable);
                                        if (autoParams.length === 0) {
                                            return null;
                                        }
                                        return (
                                            <div key={device.id}>
                                                <DawMenuSectionLabel>{device.name}</DawMenuSectionLabel>
                                                {autoParams.map((param) =>
                                                    parameterButton(
                                                        createDeviceAutomationTargetId(device.id, param.id),
                                                        param.name,
                                                        `${device.name}: ${param.name}`
                                                    )
                                                )}
                                            </div>
                                        );
                                    })}
                                </>
                            ) : null}
                        </PopoverContent>
                    </Popover>
                }
            />
            {error ? (
                <p role="alert" className="mb-2 text-xs text-destructive">
                    {error}
                </p>
            ) : null}
            {trackLanes.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {trackLanes.map((lane) => (
                        <SurfaceCard key={lane.id} className="flex items-center justify-between">
                            <span
                                className="text-[10px] text-foreground font-medium truncate pr-2"
                                ref={lane.id === addedLaneId ? addedLaneLabel : undefined}
                                title={lane.parameterName}
                            >
                                {lane.parameterName}
                            </span>
                            <Row align="stretch" gap={0.5} shrink={false}>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    aria-label={lane.visible ? 'Hide' : 'Show'}
                                    onClick={() => {
                                        toggleAutomationVisibility(lane.id);
                                    }}
                                >
                                    {lane.visible ? (
                                        <Eye className="size-3" />
                                    ) : (
                                        <EyeOff className="size-3 text-muted-foreground" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    aria-label="Remove lane"
                                    onClick={() => {
                                        removeAutomationLane(lane.id);
                                    }}
                                >
                                    <Trash2 className="size-3 text-muted-foreground" />
                                </Button>
                            </Row>
                        </SurfaceCard>
                    ))}
                </div>
            ) : (
                <DawEmptyState
                    compact
                    className="mx-1"
                    title="No automation lanes yet"
                    description="Add gain, pan, or device automation from the + menu."
                />
            )}
        </div>
    );
};

export const TrackAutomationSection = ({ track }: TrackAutomationSectionProps): ReactElement => (
    <TrackAutomation key={track.id} track={track} />
);
