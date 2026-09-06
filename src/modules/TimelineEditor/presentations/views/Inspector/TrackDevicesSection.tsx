import { type ReactElement, useState } from 'react';

import { Plus, Power, Trash2, Monitor, LayoutGrid, RefreshCw } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuDisabledRow, DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import {
    getPlatformPlugins,
    getPluginById,
    compileReorderDevicesAction,
    executeAddDeviceAction,
    executeRemoveDeviceAction,
    projectTrackToLiveStrip,
} from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import {
    pluginScanStore,
    defaultPluginScanState,
    externalPluginActivationStore,
    defaultExternalPluginActivationState,
    pluginGuiStore,
    defaultPluginGuiState,
} from '#/modules/PluginHost/stores';
import {
    closePluginGui,
    isSupportedPluginFormat,
    openPluginGui,
    resolvePluginEditorCapability,
} from '#/modules/PluginHost/useCases';
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
        descriptor_id?: string;
        has_custom_ui?: boolean;
        capability_metadata_reason?: string;
    }>;
};

export const TrackDevicesSection = ({ track, onSelectDevice }: TrackDevicesSectionProps): ReactElement => {
    const [showDeviceMenu, setShowDeviceMenu] = useState(false);

    const pluginScanState = useStore<PluginScanViewState>(pluginScanStore, defaultPluginScanState);
    const activationState = useStore(externalPluginActivationStore, defaultExternalPluginActivationState);
    const pluginGuiState = useStore(pluginGuiStore, defaultPluginGuiState);

    // Snapshot the platform catalog once per render instead of walking it three times
    // (effects / utility / analyzer) and re-querying capabilities twice.
    const platformPlugins = getPlatformPlugins();
    const effectPlugins = platformPlugins.filter((param) => param.category === 'effect');
    const utilityPlugins = platformPlugins.filter((param) => param.category === 'utility');
    const analyzerPlugins = platformPlugins.filter((param) => param.category === 'analyzer');
    const platformCapabilities = getPlatformCapabilities();
    const supportedExternalPlugins = pluginScanState.scannedPlugins.filter((plugin) =>
        isSupportedPluginFormat(plugin.format)
    );
    const supportedExternalPluginIds = new Set(
        supportedExternalPlugins.flatMap((plugin) =>
            plugin.descriptor_id ? [plugin.id, plugin.descriptor_id] : [plugin.id]
        )
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
    // An activation can succeed and still be degraded: a plugin loaded before
    // the native engine started is 'active' and processes no audio, and it
    // records why on the entry. The rack discriminates on 'error' alone, so
    // without this the degraded plugin renders as a healthy one.
    const degradedExternalDeviceMessages = new Map<string, string>(
        track.devices.flatMap((device): Array<[string, string]> => {
            const activation = device.externalInstanceId
                ? activationState.byInstanceId[device.externalInstanceId]
                : undefined;
            if (!activation || activation.status === 'error' || !activation.message) {
                return [];
            }
            return [[device.id, activation.message]];
        })
    );

    // Every external-plugin device that has an instance id. Having an id does not mean
    // the host holds the instance; each derivation below narrows by the status it needs.
    const externalDeviceEditors = track.devices.flatMap((device) =>
        device.type === 'external-plugin' && device.externalInstanceId
            ? [{ device, instanceId: device.externalInstanceId }]
            : []
    );
    // Resolved against the scan registry at render rather than recorded on the
    // device, so a plugin rescanned after an upgrade that added an editor is
    // offered one without the project having to be rewritten. Only a plugin the
    // scan positively reports as having no editor loses the control — an
    // unqueried capability keeps it, and the open attempt answers for itself.
    const editorCapableDeviceIds = new Set(
        externalDeviceEditors
            .filter(
                ({ device }) =>
                    resolvePluginEditorCapability(
                        supportedExternalPlugins.find(
                            (plugin) =>
                                plugin.id === device.externalPluginId ||
                                plugin.descriptor_id === device.externalPluginId
                        )
                    ) !== 'absent'
            )
            .map(({ device }) => device.id)
    );
    // Only an 'active' entry means the host holds an instance the GUI open/close IPC can
    // address; while loading, or with no entry at all, the control could only fail.
    const activeExternalDeviceIds = new Set(
        externalDeviceEditors
            .filter(({ instanceId }) => activationState.byInstanceId[instanceId]?.status === 'active')
            .map(({ device }) => device.id)
    );
    const openEditorDeviceIds = new Set(
        externalDeviceEditors
            .filter(({ instanceId }) => pluginGuiState.byInstanceId[instanceId]?.isOpen)
            .map(({ device }) => device.id)
    );
    // The host's own refusal from the last editor attempt. Shown on the slot
    // that failed, because a control that swallowed it reads as one that does
    // nothing.
    const editorFailureMessages = new Map<string, string>(
        externalDeviceEditors.flatMap(({ device, instanceId }): Array<[string, string]> => {
            const error = pluginGuiState.byInstanceId[instanceId]?.error;
            return error ? [[device.id, error]] : [];
        })
    );

    return (
        <div className="overflow-visible">
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Devices"
                actions={
                    <Popover open={showDeviceMenu} onOpenChange={setShowDeviceMenu}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Add device"
                                aria-haspopup="menu"
                                data-testid="add-device-button"
                            >
                                <Plus className="size-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            sideOffset={4}
                            role="menu"
                            aria-label="Add device"
                            className="daw-floating-surface w-48 p-0 py-1 rounded-md"
                        >
                            <DawMenuSectionLabel>Effects</DawMenuSectionLabel>
                            {effectPlugins.map((plugin) => (
                                <Button
                                    variant="bare"
                                    size="bare"
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
                                        // this action. The dispatch door
                                        // consumes the committed-degraded
                                        // rejection so an unrealizable
                                        // runtime never surfaces as an
                                        // unhandled rejection.
                                        void executeAddDeviceAction(track.id, plugin.id);
                                        setShowDeviceMenu(false);
                                    }}
                                >
                                    {plugin.name}
                                </Button>
                            ))}
                            <DawMenuSeparator />
                            <DawMenuSectionLabel>Utility</DawMenuSectionLabel>
                            {utilityPlugins.map((plugin) => (
                                <Button
                                    variant="bare"
                                    size="bare"
                                    type="button"
                                    key={plugin.id}
                                    className={cn(menuBtnClass, 'text-foreground hover:bg-accent/50')}
                                    role="menuitem"
                                    onClick={() => {
                                        void executeAddDeviceAction(track.id, plugin.id);
                                        setShowDeviceMenu(false);
                                    }}
                                >
                                    {plugin.name}
                                </Button>
                            ))}
                            {analyzerPlugins.length > 0 ? (
                                <>
                                    <DawMenuSeparator />
                                    <DawMenuSectionLabel>Analyzer</DawMenuSectionLabel>
                                    {analyzerPlugins.map((plugin) => (
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            key={plugin.id}
                                            className={cn(menuBtnClass, 'text-foreground')}
                                            role="menuitem"
                                            onClick={() => {
                                                void executeAddDeviceAction(track.id, plugin.id);
                                                setShowDeviceMenu(false);
                                            }}
                                        >
                                            {plugin.name}
                                        </Button>
                                    ))}
                                </>
                            ) : null}
                            <DawMenuSeparator />
                            <DawMenuSectionLabel>External</DawMenuSectionLabel>
                            {platformCapabilities.hasNativePlugins && supportedExternalPlugins.length > 0 ? (
                                <div className="max-h-32 overflow-y-auto">
                                    {supportedExternalPlugins.map((plugin) => (
                                        <Button
                                            variant="bare"
                                            size="bare"
                                            type="button"
                                            key={plugin.id}
                                            className={cn(menuBtnClass, 'justify-between text-foreground')}
                                            role="menuitem"
                                            onClick={() => {
                                                void executeUserAppAction({
                                                    type: 'loadExternalPlugin',
                                                    payload: { pluginId: plugin.id, trackId: track.id },
                                                });
                                                setShowDeviceMenu(false);
                                            }}
                                        >
                                            <span className="truncate">{plugin.name}</span>
                                            <span className="ml-1 shrink-0 rounded px-1 py-px text-[10px] font-bold uppercase text-muted-foreground bg-muted">
                                                {plugin.format}
                                            </span>
                                        </Button>
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
                        </PopoverContent>
                    </Popover>
                }
            />
            {track.devices.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {track.devices.map((device) => (
                        <ChoiceCard
                            key={device.id}
                            data-testid={`device-card-${device.id}`}
                            title={
                                editorFailureMessages.get(device.id) ?? degradedExternalDeviceMessages.get(device.id)
                            }
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
                                event.dataTransfer.setData('text/plain', device.id);
                                event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                const draggedDeviceId = event.dataTransfer.getData('text/plain');
                                const action = compileReorderDevicesAction(track.id, draggedDeviceId, device.id);
                                if (action) {
                                    void executeUserAppAction(action);
                                }
                            }}
                        >
                            <Row gap={1.5} className="pr-2">
                                <span
                                    className="text-[10px] text-muted-foreground/50 select-none shrink-0"
                                    aria-hidden="true"
                                >
                                    <Stack gap={0.5}>
                                        <div className="w-1 h-1 bg-muted rounded-full"></div>
                                        <div className="w-1 h-1 bg-muted rounded-full"></div>
                                        <div className="w-1 h-1 bg-muted rounded-full"></div>
                                    </Stack>
                                </span>
                                <div className="min-w-0">
                                    <span className="text-xs text-foreground font-medium truncate">{device.name}</span>
                                    {unavailableExternalDeviceIds.has(device.id) ? (
                                        <span className="block text-[9px] text-muted-foreground">Unavailable</span>
                                    ) : null}
                                </div>
                            </Row>
                            <Row gap={0.5} shrink={false}>
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
                                        // Action boundary: the bypassDevice
                                        // action is undoable; the raw use case
                                        // write never entered history (#1938
                                        // precedent for the add path).
                                        void executeUserAppAction({
                                            type: 'bypassDevice',
                                            payload: { deviceId: device.id, bypassed: !device.bypassed },
                                        });
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
                                !unavailableExternalDeviceIds.has(device.id) &&
                                activeExternalDeviceIds.has(device.id) &&
                                editorCapableDeviceIds.has(device.id) ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-6 w-6"
                                                aria-label={`${openEditorDeviceIds.has(device.id) ? 'Close' : 'Open'} editor for ${device.name}`}
                                                aria-pressed={openEditorDeviceIds.has(device.id)}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    // One control, both directions: the
                                                    // editor is a window the user opened,
                                                    // and every DAW closes it from the
                                                    // same place it was opened.
                                                    void (openEditorDeviceIds.has(device.id)
                                                        ? closePluginGui(device.externalInstanceId!)
                                                        : openPluginGui(device.externalInstanceId!));
                                                }}
                                            >
                                                <LayoutGrid className="size-3 text-primary" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            {editorFailureMessages.get(device.id) ??
                                                (openEditorDeviceIds.has(device.id)
                                                    ? 'Close plugin editor'
                                                    : 'Open plugin editor')}
                                        </TooltipContent>
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
                                        void executeRemoveDeviceAction(device.id);
                                    }}
                                >
                                    <Trash2 className="size-3 text-muted-foreground" />
                                </Button>
                            </Row>
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
