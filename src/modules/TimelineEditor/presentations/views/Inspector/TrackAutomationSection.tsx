import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { addAutomationLane, toggleAutomationVisibility, removeAutomationLane } from '#/modules/Automation/useCases';
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

export const TrackAutomationSection = ({ track }: TrackAutomationSectionProps): ReactElement => {
    const [showAutoMenu, setShowAutoMenu] = useState(false);
    const autoMenuRef = useRef<HTMLDivElement>(null);

    const autoState = useStore<TrackAutomationState>(automationStore, { lanes: [] });

    const trackLanes = autoState.lanes.filter((lane) => lane.trackId === track.id && !lane.clipId);

    useEffect(() => {
        if (!showAutoMenu) {
            return undefined;
        }
        const handleClick = (event: MouseEvent): void => {
            if (autoMenuRef.current && !autoMenuRef.current.contains(event.target as Node)) {
                setShowAutoMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, [showAutoMenu]);

    return (
        <div className="overflow-visible">
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Automation"
                actions={
                    <div className="relative" ref={autoMenuRef}>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                                setShowAutoMenu(!showAutoMenu);
                            }}
                            aria-label="Add automation lane"
                        >
                            <Plus className="size-3" />
                        </Button>
                        {showAutoMenu ? (
                            <div
                                className="daw-floating-surface absolute right-0 top-full z-50 mt-1 w-48 rounded-md py-1"
                                role="menu"
                            >
                                <DawMenuSectionLabel>Track</DawMenuSectionLabel>
                                <button
                                    type="button"
                                    className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                    role="menuitem"
                                    onClick={() => {
                                        addAutomationLane(track.id, 'gain', 'Gain');
                                        setShowAutoMenu(false);
                                    }}
                                >
                                    Gain
                                </button>
                                <button
                                    type="button"
                                    className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                    role="menuitem"
                                    onClick={() => {
                                        addAutomationLane(track.id, 'pan', 'Pan');
                                        setShowAutoMenu(false);
                                    }}
                                >
                                    Pan
                                </button>
                                {track.devices.length > 0 ? (
                                    <>
                                        <DawMenuSeparator />
                                        {track.devices.map((device) => {
                                            const plugin = getAutomationDeviceDescriptor(device.type);
                                            if (!plugin) {
                                                return null;
                                            }
                                            const autoParams = plugin.parameters.filter(
                                                (param) =>
                                                    param.automatable &&
                                                    !findEquivalentAutomationLane(
                                                        createDeviceAutomationTargetId(device.id, param.id),
                                                        trackLanes,
                                                        track.devices
                                                    )
                                            );
                                            if (autoParams.length === 0) {
                                                return null;
                                            }
                                            return (
                                                <div key={device.id}>
                                                    <DawMenuSectionLabel>{device.name}</DawMenuSectionLabel>
                                                    {autoParams.map((param) => (
                                                        <button
                                                            type="button"
                                                            key={param.id}
                                                            className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                                            role="menuitem"
                                                            onClick={() => {
                                                                addAutomationLane(
                                                                    track.id,
                                                                    createDeviceAutomationTargetId(device.id, param.id),
                                                                    `${device.name}: ${param.name}`
                                                                );
                                                                setShowAutoMenu(false);
                                                            }}
                                                        >
                                                            {param.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        })}
                                    </>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                }
            />
            {trackLanes.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {trackLanes.map((lane) => (
                        <SurfaceCard key={lane.id} className="flex items-center justify-between">
                            <span
                                className="text-[10px] text-foreground font-medium truncate pr-2"
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
