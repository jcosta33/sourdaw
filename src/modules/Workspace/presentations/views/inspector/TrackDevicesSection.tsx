import { type ReactElement, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from '#/components/ui/button';
import { Plus, Power, Trash2, Monitor } from 'lucide-react';
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

export type TrackDevicesSectionProps = {
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
        <section>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Devices</h3>
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
                            className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-border/50 bg-surface-raised py-1 shadow-lg"
                            role="menu"
                        >
                            <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Effects
                            </p>
                            {BUILTIN_PLUGINS.filter((p) => p.category === 'effect').map((plugin) => (
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
                                            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                            role="menuitem"
                                            onClick={() => {
                                                addExternalDevice(track.id, plugin.id, plugin.name);
                                                setShowDeviceMenu(false);
                                            }}
                                        >
                                            <span className="truncate">{plugin.name}</span>
                                            <span className="ml-1 shrink-0 rounded px-1 py-px text-[7px] font-bold uppercase text-muted-foreground bg-muted">
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
                <div className="space-y-1">
                    {track.devices.map((device, deviceIndex) => (
                        <div
                            key={device.id}
                            className="flex items-center justify-between rounded bg-surface-overlay px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-accent/50"
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
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground/50 select-none">≡</span>
                                <span className="text-xs text-foreground">{device.name}</span>
                            </div>
                            <div className="flex gap-0.5">
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`${device.bypassed ? 'Enable' : 'Bypass'} ${device.name}`}
                                    aria-pressed={device.bypassed}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        bypassDevice(device.id, !device.bypassed);
                                    }}
                                >
                                    <Power
                                        className={`size-3 ${device.bypassed ? 'text-muted-foreground' : 'text-emerald-400'}`}
                                    />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Remove ${device.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeDevice(device.id);
                                    }}
                                >
                                    <Trash2 className="size-3 text-muted-foreground" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground">No devices. Click + to add.</p>
            )}
        </section>
    );
};
