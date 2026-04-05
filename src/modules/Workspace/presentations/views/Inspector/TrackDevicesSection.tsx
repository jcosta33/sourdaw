import { type ReactElement, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuDisabledRow, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Button } from '#/components/ui/button';
import { Plus, Power, Trash2, Monitor, LayoutGrid } from 'lucide-react';
import { getPlatformPlugins } from '#/modules/Arrangement/useCases/getPlatformPlugins';
import { getPluginById } from '#/modules/Arrangement/useCases/getPluginById';
import { bypassDevice } from '#/modules/Arrangement/useCases/device/bypassDevice';
import { removeDevice } from '#/modules/Arrangement/useCases/device/removeDevice';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { addExternalDevice } from '#/modules/Arrangement/useCases/device/addExternalDevice';
import { reorderDevices } from '#/modules/Arrangement/useCases/device/reorderDevices';
import { pluginScanStore, defaultPluginScanState } from '#/modules/Plugin/stores/pluginScanStore';
import { type Track } from '../../../models/TrackViewTypes';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/helpers/platformCapabilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import { openPluginGui } from '#/modules/Plugin/useCases/pluginLifecycle';
import { ChoiceCard } from '../../components/Inspector/ChoiceCard';

type TrackDevicesSectionProps = {
    track: Track;
    onSelectDevice: (id: string) => void;
};

export const TrackDevicesSection = ({ track, onSelectDevice }: TrackDevicesSectionProps): ReactElement => {
    const [showDeviceMenu, setShowDeviceMenu] = useState(false);
    const deviceMenuRef = useRef<HTMLDivElement>(null);

    const pluginScanState = useSyncExternalStore(
        (cb) => pluginScanStore.subscribe(cb),
        () => pluginScanStore.value ?? defaultPluginScanState
    );

    useEffect(() => {
        if (!showDeviceMenu) {
            return;
        }
        const handleClick = (e: MouseEvent): void => {
            if (deviceMenuRef.current && !deviceMenuRef.current.contains(e.target as Node)) {
                setShowDeviceMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, [showDeviceMenu]);

    return (
        <div className="overflow-visible">
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Devices"
                actions={
                    <div className="relative" ref={deviceMenuRef}>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                                setShowDeviceMenu(!showDeviceMenu);
                            }}
                            aria-label="Add device"
                        >
                            <Plus className="size-3" />
                        </Button>
                        {showDeviceMenu ? (
                            <div
                                className="daw-floating-surface absolute right-0 top-full z-50 mt-1 w-48 rounded-md py-1"
                                role="menu"
                            >
                                <DawMenuSectionLabel>Effects</DawMenuSectionLabel>
                                {getPlatformPlugins()
                                    .filter((p) => p.category === 'effect')
                                    .map((plugin) => (
                                        <button
                                            type="button"
                                            key={plugin.id}
                                            className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06] transition-colors"
                                            role="menuitem"
                                            onClick={() => {
                                                addDevice(track.id, plugin.name);
                                                setShowDeviceMenu(false);
                                            }}
                                        >
                                            {plugin.name}
                                        </button>
                                    ))}
                                <DawMenuSeparator />
                                <DawMenuSectionLabel>Utility</DawMenuSectionLabel>
                                {getPlatformPlugins()
                                    .filter((p) => p.category === 'utility')
                                    .map((plugin) => (
                                        <button
                                            type="button"
                                            key={plugin.id}
                                            className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                            role="menuitem"
                                            onClick={() => {
                                                addDevice(track.id, plugin.name);
                                                setShowDeviceMenu(false);
                                            }}
                                        >
                                            {plugin.name}
                                        </button>
                                    ))}
                                {getPlatformPlugins().filter((p) => p.category === 'analyzer').length > 0 ? (
                                    <>
                                        <DawMenuSeparator />
                                        <DawMenuSectionLabel>Analyzer</DawMenuSectionLabel>
                                        {getPlatformPlugins()
                                            .filter((p) => p.category === 'analyzer')
                                            .map((plugin) => (
                                                <button
                                                    type="button"
                                                    key={plugin.id}
                                                    className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06] transition-colors"
                                                    role="menuitem"
                                                    onClick={() => {
                                                        addDevice(track.id, plugin.name);
                                                        setShowDeviceMenu(false);
                                                    }}
                                                >
                                                    {plugin.name}
                                                </button>
                                            ))}
                                    </>
                                ) : null}
                                <DawMenuSeparator />
                                <DawMenuSectionLabel>External</DawMenuSectionLabel>
                                {getPlatformCapabilities().hasNativePlugins &&
                                pluginScanState.scannedPlugins.length > 0 ? (
                                    <div className="max-h-32 overflow-y-auto">
                                        {pluginScanState.scannedPlugins.map((plugin) => (
                                            <button
                                                type="button"
                                                key={plugin.id}
                                                className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-white/[0.06] transition-colors"
                                                role="menuitem"
                                                onClick={() => {
                                                    addExternalDevice(track.id, plugin.id, plugin.name);
                                                    setShowDeviceMenu(false);
                                                }}
                                            >
                                                <span className="truncate">{plugin.name}</span>
                                                <span className="ml-1 shrink-0 rounded px-1 py-px text-[10px] font-bold uppercase text-muted-foreground bg-muted">
                                                    {plugin.format}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <DawMenuDisabledRow
                                                icon={
                                                    <Monitor
                                                        className="size-3 shrink-0 text-muted-foreground"
                                                        aria-hidden="true"
                                                    />
                                                }
                                            >
                                                {getPlatformCapabilities().hasNativePlugins
                                                    ? 'No plugins found — scan first'
                                                    : 'Desktop app required'}
                                            </DawMenuDisabledRow>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-56 text-center">
                                            {getPlatformCapabilities().hasNativePlugins
                                                ? 'Scan for plugins in Preferences → Plugin Paths'
                                                : DISABLED_REASONS.nativePlugins}
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                            </div>
                        ) : null}
                    </div>
                }
            />
            {track.devices.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {track.devices.map((device, deviceIndex) => (
                        <ChoiceCard
                            key={device.id}
                            className={cn(
                                'flex items-center justify-between cursor-grab active:cursor-grabbing',
                                device.bypassed ? 'opacity-50' : ''
                            )}
                            onClick={() => {
                                const descriptor = getPluginById(device.type);
                                if (descriptor?.hasCustomUI) {
                                    document.dispatchEvent(
                                        new CustomEvent(`sourdaw:show-${device.type}-tab`, {
                                            detail: { deviceId: device.id },
                                        })
                                    );
                                } else {
                                    onSelectDevice(device.id);
                                }
                            }}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', String(deviceIndex));
                                e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                                if (!isNaN(fromIndex) && fromIndex !== deviceIndex) {
                                    reorderDevices(track.id, fromIndex, deviceIndex);
                                }
                            }}
                        >
                            <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                <span
                                    className="text-[10px] text-muted-foreground/50 select-none shrink-0"
                                    aria-hidden="true"
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <div className="w-1 h-1 bg-muted rounded-full"></div>
                                        <div className="w-1 h-1 bg-muted rounded-full"></div>
                                        <div className="w-1 h-1 bg-muted rounded-full"></div>
                                    </div>
                                </span>
                                <span className="text-xs text-foreground font-medium truncate">{device.name}</span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    aria-label={`${device.bypassed ? 'Enable' : 'Bypass'} ${device.name}`}
                                    aria-pressed={device.bypassed}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        bypassDevice(device.id, !device.bypassed);
                                    }}
                                >
                                    <Power
                                        className={`size-3 ${device.bypassed ? 'text-muted-foreground' : 'text-[var(--color-state-success)]'}`}
                                    />
                                </Button>
                                {device.type === 'external-plugin' && device.externalInstanceId ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-6 w-6"
                                                aria-label={`Open editor for ${device.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void openPluginGui(device.externalInstanceId!);
                                                }}
                                            >
                                                <LayoutGrid className="size-3 text-primary" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">Open plugin editor</TooltipContent>
                                    </Tooltip>
                                ) : null}
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    aria-label={`Remove ${device.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeDevice(device.id);
                                    }}
                                >
                                    <Trash2 className="size-3 text-muted-foreground" />
                                </Button>
                            </div>
                        </ChoiceCard>
                    ))}
                </div>
            ) : (
                <DawBlockedState
                    compact
                    className="mx-1"
                    eyebrow="Device Rack"
                    title="Nothing in the oven yet"
                    description="Hit + to add an instrument, effect, utility, or analyzer."
                    summary="The rack can host built-in effects, analyzers, and desktop plugins when available."
                />
            )}
        </div>
    );
};
