import { type ReactElement, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { BUILTIN_PLUGINS } from '#/modules/Arrangement/useCases/trackQueries';
import { addAutomationLane } from '#/modules/Automation/useCases/automation/addAutomationLane';
import { toggleAutomationVisibility } from '#/modules/Automation/useCases/automation/toggleAutomationVisibility';
import { removeAutomationLane } from '#/modules/Automation/useCases/automation/removeAutomationLane';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

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
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 flex flex-row items-center justify-between">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Automation</div>
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
                            className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border/50 bg-popover py-1 shadow-lg"
                            role="menu"
                        >
                            <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Track
                            </p>
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
                            {track.devices.length > 0 && (
                                <>
                                    <div className="mx-2 my-1 border-t border-border/30" />
                                    {track.devices.map((device) => {
                                        const plugin = BUILTIN_PLUGINS.find(
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
                                                <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                                    {device.name}
                                                </p>
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
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
            {trackLanes.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {trackLanes.map((lane) => (
                        <Card
                            key={lane.id}
                            className="flex items-center justify-between rounded-md shadow-none bg-surface-base border-border/50 p-2"
                        >
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
                        </Card>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground px-1">No automation lanes.</p>
            )}
        </div>
    );
};
