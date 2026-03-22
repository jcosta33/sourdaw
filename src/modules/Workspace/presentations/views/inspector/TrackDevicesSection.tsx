import { type ReactElement, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Plus, Power, Trash2, Monitor, LayoutGrid } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import {
    bypassDevice,
    removeDevice,
    addDevice,
    addExternalDevice,
    reorderDevices,
} from '../../../useCases/workspaceViewActions';
import { pluginScanStore, defaultPluginScanState } from '#/modules/AudioEngine/stores/pluginScanStore';
import { type Track } from '../../../useCases/workspaceViewActions';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/helpers/platformCapabilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import { openPluginGui } from '#/modules/AudioEngine/useCases/pluginBridge';

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
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 flex flex-row items-center justify-between">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Devices</div>
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
                    {showDeviceMenu && (
                        <div
                            className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border-soft border-t-[var(--color-light-edge)] bg-surface-overlay py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
                            role="menu"
                        >
                            <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Effects
                            </p>
                            {BUILTIN_PLUGINS.filter((p) => p.category === 'effect').map((plugin) => (
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
                            <div className="mx-2 my-1 border-t border-border/30" />
                            <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Utility
                            </p>
                            {BUILTIN_PLUGINS.filter((p) => p.category === 'utility').map((plugin) => (
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
                            <div className="mx-2 my-1 border-t border-border/30" />
                            <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                External
                            </p>
                            {getPlatformCapabilities().hasNativePlugins && pluginScanState.scannedPlugins.length > 0 ? (
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
                                        <div
                                            className="flex items-center gap-2 px-3 py-2 opacity-50 cursor-not-allowed"
                                            aria-disabled="true"
                                        >
                                            <Monitor
                                                className="size-3 text-muted-foreground shrink-0"
                                                aria-hidden="true"
                                            />
                                            <span className="text-[10px] text-muted-foreground">
                                                {getPlatformCapabilities().hasNativePlugins
                                                    ? 'No plugins found — scan first'
                                                    : 'Desktop app required'}
                                            </span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-56 text-center">
                                        {getPlatformCapabilities().hasNativePlugins
                                            ? 'Scan for plugins in Preferences → Plugin Paths'
                                            : DISABLED_REASONS.nativePlugins}
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {track.devices.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {track.devices.map((device, deviceIndex) => (
                        <Card
                            key={device.id}
                            className={cn(
                                'flex items-center justify-between rounded-md shadow-none bg-surface-base border-border/50 p-2 cursor-grab active:cursor-grabbing hover:bg-surface-raised transition-colors',
                                device.bypassed ? 'opacity-50' : ''
                            )}
                            onClick={() => {
                                onSelectDevice(device.id);
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
                                {device.type === 'external-plugin' && device.externalInstanceId && (
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
                                )}
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
                        </Card>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground px-1">No devices. Click + to add.</p>
            )}
        </div>
    );
};
