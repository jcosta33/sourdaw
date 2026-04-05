import { type ReactElement, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Button } from '#/components/ui/button';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { getBuiltinPlugins } from '#/modules/Arrangement/useCases/getBuiltinPlugins';
import { addAutomationLane } from '#/modules/Automation/useCases/automation/addAutomationLane';
import { toggleAutomationVisibility } from '#/modules/Automation/useCases/automation/toggleAutomationVisibility';
import { removeAutomationLane } from '#/modules/Automation/useCases/automation/removeAutomationLane';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type TrackAutomationSectionProps = {
    track: Track;
};

export const TrackAutomationSection = ({ track }: TrackAutomationSectionProps): ReactElement => {
    const [showAutoMenu, setShowAutoMenu] = useState(false);
    const autoMenuRef = useRef<HTMLDivElement>(null);

    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(cb),
        () => automationStore.value
    );

    const trackLanes = autoState?.lanes.filter((l) => l.trackId === track.id) ?? [];

    useEffect(() => {
        if (!showAutoMenu) {
            return;
        }
        const handleClick = (e: MouseEvent): void => {
            if (autoMenuRef.current && !autoMenuRef.current.contains(e.target as Node)) {
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
                                            const plugin = getBuiltinPlugins().find(
                                                (p) => p.name.toLowerCase() === device.type.toLowerCase()
                                            );
                                            if (!plugin) {
                                                return null;
                                            }
                                            const autoParams = plugin.parameters.filter((p) => p.automatable);
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
                                                                    param.id,
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
                            <div className="flex gap-0.5 shrink-0">
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
                            </div>
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
