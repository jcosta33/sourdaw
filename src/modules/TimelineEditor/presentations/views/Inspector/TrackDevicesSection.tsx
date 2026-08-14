import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Plus, Power, Trash2, Monitor, LayoutGrid, RefreshCw } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuDisabledRow, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import {
    getPlatformPlugins,
    getPluginById,
    bypassDevice,
    removeDevice,
    addExternalDevice,
    reorderDevices,
    projectTrackToLiveStrip,
} from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import {
    pluginScanStore,
    defaultPluginScanState,
    externalPluginActivationStore,
    defaultExternalPluginActivationState,
} from '#/modules/PluginHost/stores';
import { openPluginGui } from '#/modules/PluginHost/useCases';
import { showDevicePanelForType } from '#/modules/WorkspaceShell/useCases';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/utils/platformCapabilities';
import { cn } from '#/utils/Styles/cn';
import { menuBtnClass } from '#/utils/UI/contextMenuStyles';

import { type Track } from '../../../models/TrackViewTypes';
import { ChoiceCard } from '../../components/Inspector/ChoiceCard';

type TrackDevicesSectionProps = {
    track: Track;
    onSelectDevice: (id: string) => void;
};

type PluginScanViewState = {
    scannedPlugins: Array<{
        id: string;
        name: string;
        format: string;
        clap_id?: string;
    }>;
};

export const TrackDevicesSection = ({ track, onSelectDevice }: TrackDevicesSectionProps): ReactElement => {
    const [showDeviceMenu, setShowDeviceMenu] = useState(false);
    const deviceMenuRef = useRef<HTMLDivElement>(null);

    const pluginScanState = useStore<PluginScanViewState>(pluginScanStore, defaultPluginScanState);
    const activationState = useStore(externalPluginActivationStore, defaultExternalPluginActivationState);

    // Snapshot the platform catalog once per render instead of walking it three times
    // (effects / utility / analyzer) and re-querying capabilities twice.
    const platformPlugins = getPlatformPlugins();
    const effectPlugins = platformPlugins.filter((param) => param.category === 'effect');
    const utilityPlugins = platformPlugins.filter((param) => param.category === 'utility');
    const analyzerPlugins = platformPlugins.filter((param) => param.category === 'analyzer');
    const platformCapabilities = getPlatformCapabilities();
    const supportedExternalPlugins = pluginScanState.scannedPlugins.filter(
        (plugin) => plugin.format.toLowerCase() === 'clap'
    );
    const supportedExternalPluginIds = new Set(
        supportedExternalPlugins.flatMap((plugin) => (plugin.clap_id ? [plugin.id, plugin.clap_id] : [plugin.id]))
    );
    const unavailableExternalDeviceIds = new Set(
        track.devices
            .filter(
                (device) =>
                    device.type === 'external-plugin' &&
                    (!device.externalPluginId ||
                        !supportedExternalPluginIds.has(device.externalPluginId) ||
                        (device.externalInstanceId
                            ? activationState.byInstanceId[device.externalInstanceId]?.status === 'error'
                            : false))
            )
            .map((device) => device.id)
    );

    useEffect(() => {
        if (!showDeviceMenu) {
            return undefined;
        }
        const handleClick = (event: MouseEvent): void => {
            if (deviceMenuRef.current && !deviceMenuRef.current.contains(event.target as Node)) {
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
                            data-testid="add-device-button"
                        >
                            <Plus className="size-3" />
                        </Button>
                        {showDeviceMenu ? (
                            <div
                                className="daw-floating-surface absolute right-0 top-full z-50 mt-1 w-48 rounded-md py-1"
                                role="menu"
                            >
                                <DawMenuSectionLabel>Effects</DawMenuSectionLabel>
                                {effectPlugins.map((plugin) => (
                                    <button
                                        type="button"
                                        key={plugin.id}
                                        className={cn(menuBtnClass, 'text-foreground')}
                                        role="menuitem"
                                        onClick={() => {
                                            // Route through the action
                                            // boundary so the add lands in
                                            // one Automerge transaction and
                                            // is undoable — the same
                                            // mutation issued by an AI
                                            // prompt already goes through
                                            // this action.
                                            executeAppAction({
                                                type: 'addDevice',
                                                payload: { trackId: track.id, deviceType: plugin.id },
                                            });
                                            setShowDeviceMenu(false);
                                        }}
                                    >
                                        {plugin.name}
                                    </button>
                                ))}
                                <DawMenuSeparator />
                                <DawMenuSectionLabel>Utility</DawMenuSectionLabel>
                                {utilityPlugins.map((plugin) => (
                                    <button
                                        type="button"
                                        key={plugin.id}
                                        className={cn(menuBtnClass, 'text-foreground hover:bg-accent/50')}
                                        role="menuitem"
                                        onClick={() => {
                                            executeAppAction({
                                                type: 'addDevice',
                                                payload: { trackId: track.id, deviceType: plugin.id },
                                            });
                                            setShowDeviceMenu(false);
                                        }}
                                    >
                                        {plugin.name}
                                    </button>
                                ))}
                                {analyzerPlugins.length > 0 ? (
                                    <>
                                        <DawMenuSeparator />
                                        <DawMenuSectionLabel>Analyzer</DawMenuSectionLabel>
                                        {analyzerPlugins.map((plugin) => (
                                            <button
                                                type="button"
                                                key={plugin.id}
                                                className={cn(menuBtnClass, 'text-foreground')}
                                                role="menuitem"
                                                onClick={() => {
                                                    executeAppAction({
                                                        type: 'addDevice',
                                                        payload: { trackId: track.id, deviceType: plugin.id },
                                                    });
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
                                {platformCapabilities.hasNativePlugins && supportedExternalPlugins.length > 0 ? (
                                    <div className="max-h-32 overflow-y-auto">
                                        {supportedExternalPlugins.map((plugin) => (
                                            <button
                                                type="button"
                                                key={plugin.id}
                                                className={cn(menuBtnClass, 'justify-between text-foreground')}
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
                                                {platformCapabilities.hasNativePlugins
                                                    ? 'No plugins found — scan first'
                                                    : 'Desktop app required'}
                                            </DawMenuDisabledRow>
                                        </TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-56 text-center">
                                            {platformCapabilities.hasNativePlugins
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
                            data-testid={`device-card-${device.id}`}
                            className={cn(
                                'flex items-center justify-between cursor-grab active:cursor-grabbing',
                                device.bypassed || unavailableExternalDeviceIds.has(device.id) ? 'opacity-50' : ''
                            )}
                            onClick={() => {
                                const descriptor = getPluginById(device.type);
                                if (descriptor?.hasCustomUI) {
                                    showDevicePanelForType(device.type, device.id);
                                } else {
                                    onSelectDevice(device.id);
                                }
                            }}
                            draggable
                            onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', String(deviceIndex));
                                event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                const fromIndex = parseInt(event.dataTransfer.getData('text/plain'), 10);
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
                                <div className="min-w-0">
                                    <span className="text-xs text-foreground font-medium truncate">{device.name}</span>
                                    {unavailableExternalDeviceIds.has(device.id) ? (
                                        <span className="block text-[9px] text-muted-foreground">Unavailable</span>
                                    ) : null}
                                </div>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    aria-label={
                                        unavailableExternalDeviceIds.has(device.id)
                                            ? `${device.name} unavailable`
                                            : `${device.bypassed ? 'Enable' : 'Bypass'} ${device.name}`
                                    }
                                    aria-pressed={device.bypassed}
                                    disabled={unavailableExternalDeviceIds.has(device.id)}
                                    data-testid={`device-bypass-${device.id}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        bypassDevice(device.id, !device.bypassed);
                                    }}
                                >
                                    <Power
                                        className={`size-3 ${device.bypassed || unavailableExternalDeviceIds.has(device.id) ? 'text-muted-foreground' : 'text-[var(--color-state-success)]'}`}
                                    />
                                </Button>
                                {unavailableExternalDeviceIds.has(device.id) && device.externalInstanceId ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-6 w-6"
                                                aria-label={`Retry ${device.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    projectTrackToLiveStrip({
                                                        trackId: track.id,
                                                        activateDormantExternalPlugins: true,
                                                    });
                                                }}
                                            >
                                                <RefreshCw className="size-3 text-muted-foreground" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">Retry plugin activation</TooltipContent>
                                    </Tooltip>
                                ) : null}
                                {device.type === 'external-plugin' &&
                                device.externalInstanceId &&
                                !unavailableExternalDeviceIds.has(device.id) ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-6 w-6"
                                                aria-label={`Open editor for ${device.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
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
                                    data-testid={`device-remove-${device.id}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
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
