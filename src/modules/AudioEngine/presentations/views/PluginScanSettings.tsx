import { type ReactElement, useEffect, useRef, useState } from 'react';

import {
    FolderOpen,
    FolderPlus,
    Trash2,
    RefreshCw,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Info,
    Plug,
    Monitor,
    ShieldAlert,
} from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { pluginScanStore, defaultPluginScanState } from '#/modules/PluginHost/stores';
import {
    addPluginFolder,
    refreshPluginFolderGrants,
    removePluginFolder,
    removeScanPath,
    startPluginScan,
} from '#/modules/PluginHost/useCases';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/utils/platformCapabilities';

export const PluginScanSettings = (): ReactElement | null => {
    const state = useStore(pluginScanStore, defaultPluginScanState);
    const [isAddingFolder, setIsAddingFolder] = useState(false);
    const [folderError, setFolderError] = useState<string | null>(null);
    const [folderStatus, setFolderStatus] = useState<string | null>(null);
    const addFolderButtonRef = useRef<HTMLButtonElement>(null);

    const { hasPluginScanning } = getPlatformCapabilities();

    // The native grant store is the authority for added folders; the store
    // never restores them, so the list is read fresh each time settings open.
    useEffect(() => {
        if (!hasPluginScanning) {
            return;
        }
        const showRefreshFailure = async (): Promise<void> => {
            const outcome = await refreshPluginFolderGrants();
            if (!outcome.refreshed) {
                setFolderError(outcome.reason);
            }
        };
        void showRefreshFailure();
    }, [hasPluginScanning]);

    if (!hasPluginScanning) {
        return (
            <section>
                <Row gap={1} className="mb-2">
                    <Plug className="size-3" aria-hidden="true" />
                    <DawEyebrowLabel size="sm">Plugin Paths</DawEyebrowLabel>
                </Row>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DawEmptyState
                            compact
                            className="cursor-not-allowed opacity-50"
                            icon={<Monitor className="size-4" aria-hidden="true" />}
                            title="Plugin scanning unavailable"
                            description="Desktop app required"
                        />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 text-center">
                        {DISABLED_REASONS.pluginScanning}
                    </TooltipContent>
                </Tooltip>
            </section>
        );
    }

    // The shell opens the picker and grants the folder it returns; the
    // renderer never names the path, so there is nothing to type here.
    const handleAddFolder = async (): Promise<void> => {
        setIsAddingFolder(true);
        setFolderError(null);
        setFolderStatus(null);
        try {
            const outcome = await addPluginFolder();
            if (outcome.added) {
                setFolderStatus(`Added ${outcome.path}`);
            } else if ('reason' in outcome) {
                setFolderError(outcome.reason);
            }
        } finally {
            setIsAddingFolder(false);
        }
    };

    const handleRemoveFolder = async (path: string): Promise<void> => {
        setFolderError(null);
        setFolderStatus(null);
        const outcome = await removePluginFolder(path);
        if (!outcome.removed) {
            setFolderError(outcome.reason);
            return;
        }
        // The removed row took the focused Remove button with it; without
        // this, keyboard focus falls back to the document body.
        addFolderButtonRef.current?.focus();
        setFolderStatus(`Removed ${path}`);
    };

    const handleScan = () => {
        void startPluginScan();
    };

    const handleRetryQuarantined = () => {
        void startPluginScan({ retryQuarantined: true });
    };

    const lastScanLabel = state.lastScanTime ? new Date(state.lastScanTime).toLocaleString() : 'Never';

    return (
        <section>
            <Row gap={1} className="mb-2">
                <Plug className="size-3" aria-hidden="true" />
                <DawEyebrowLabel size="sm">Plugin Paths</DawEyebrowLabel>
            </Row>
            <Stack gap={2}>
                {state.scanPaths.length > 0 ? (
                    <Stack gap={1}>
                        {state.scanPaths.map((path) => (
                            <Row gap={1.5} className="group" key={path}>
                                <FolderOpen className="size-3 text-muted-foreground shrink-0" aria-hidden="true" />
                                <span className="flex-1 text-[10px] text-foreground truncate font-mono" title={path}>
                                    {path}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => {
                                        removeScanPath(path);
                                    }}
                                    aria-label={`Remove path ${path}`}
                                >
                                    <Trash2 className="size-3 text-destructive" />
                                </Button>
                            </Row>
                        ))}
                    </Stack>
                ) : null}

                {state.grantedFolders.length > 0 ? (
                    <Stack gap={1}>
                        <DawEyebrowLabel size="sm">Added folders</DawEyebrowLabel>
                        <ul className="flex flex-col gap-1" aria-label="Added folders">
                            {state.grantedFolders.map((folder) => (
                                <li className="group flex flex-col" key={folder.path}>
                                    <Row gap={1.5}>
                                        <FolderOpen
                                            className="size-3 text-muted-foreground shrink-0"
                                            aria-hidden="true"
                                        />
                                        <span
                                            className="flex-1 text-[10px] text-foreground truncate font-mono"
                                            title={folder.path}
                                        >
                                            {folder.path}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                                            onClick={() => {
                                                void handleRemoveFolder(folder.path);
                                            }}
                                            aria-label={`Remove plugin folder ${folder.path}`}
                                        >
                                            <Trash2 className="size-3 text-destructive" aria-hidden="true" />
                                        </Button>
                                    </Row>
                                    {folder.unavailableReason !== null ? (
                                        <span className="pl-[18px] text-[10px] text-destructive">
                                            {folder.unavailableReason}
                                        </span>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </Stack>
                ) : null}

                <Button
                    ref={addFolderButtonRef}
                    variant="outline"
                    size="xs"
                    className="w-fit gap-1 text-xs"
                    onClick={() => {
                        void handleAddFolder();
                    }}
                    disabled={isAddingFolder}
                >
                    <FolderPlus className="size-3" aria-hidden="true" />
                    Add Folder
                </Button>

                <p role="status" className="text-[10px] text-muted-foreground empty:hidden">
                    {folderStatus}
                </p>

                {folderError !== null ? (
                    <Row align="start" gap={1} className="text-[10px] text-destructive" role="alert">
                        <AlertCircle className="size-3 shrink-0 mt-px" aria-hidden="true" />
                        <span>{folderError}</span>
                    </Row>
                ) : null}

                <Row gap={2}>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-xs"
                        onClick={handleScan}
                        disabled={state.isScanning}
                    >
                        {state.isScanning ? (
                            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        ) : (
                            <RefreshCw className="size-3" aria-hidden="true" />
                        )}
                        {state.isScanning ? 'Scanning...' : 'Scan Now'}
                    </Button>

                    <div className="flex-1" />
                </Row>

                <Stack gap={1}>
                    <DawReadoutRow label="Plugins Found" value={state.scannedPlugins.length} className="gap-2" />
                    <DawReadoutRow
                        label="Last Scan"
                        value={lastScanLabel}
                        className="gap-2"
                        valueClassName="truncate text-right"
                    />
                </Stack>

                {state.errors.length > 0 ? (
                    <Stack gap={1} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                        {state.errors.map((err, index) => (
                            <Row align="start" gap={1} className="text-[10px] text-destructive" key={index}>
                                <AlertCircle className="size-3 shrink-0 mt-px" aria-hidden="true" />
                                <span>{err}</span>
                            </Row>
                        ))}
                    </Stack>
                ) : null}

                {/*
                 * Informational, not destructive. These say why a recognised
                 * plugin format is not loaded — the expected outcome of a scan
                 * that went fine — so they carry no alert colour and no alert
                 * icon, and they do not gate the success badge below.
                 */}
                {state.notices.length > 0 ? (
                    <Stack gap={1} className="rounded-md border border-border/60 bg-surface-overlay/40 p-2">
                        {state.notices.map((notice) => (
                            <Row align="start" gap={1} className="text-[10px] text-muted-foreground" key={notice}>
                                <Info className="size-3 shrink-0 mt-px" aria-hidden="true" />
                                <span>{notice}</span>
                            </Row>
                        ))}
                    </Stack>
                ) : null}

                {/*
                 * A quarantined candidate is not an error to render
                 * destructively: it is the host's own decision not to retry a
                 * binary whose helper crashed or hung, until the user asks it
                 * to (#2911). The retry button is the only route back — the
                 * default scan above never clears a record on its own.
                 */}
                {state.quarantined.length > 0 ? (
                    <Stack
                        gap={1}
                        className="rounded-md border border-[var(--color-accent-peach)]/30 bg-[var(--color-accent-peach)]/5 p-2"
                    >
                        <Row align="center" gap={1} className="justify-between">
                            <DawMicroBadge tone="peach">
                                <ShieldAlert className="size-3" aria-hidden="true" />
                                <span>{state.quarantined.length} quarantined</span>
                            </DawMicroBadge>
                            <Button
                                variant="outline"
                                size="xs"
                                className="gap-1 text-xs"
                                onClick={handleRetryQuarantined}
                                disabled={state.isScanning}
                            >
                                <RefreshCw className="size-3" aria-hidden="true" />
                                Retry Quarantined
                            </Button>
                        </Row>
                        {state.quarantined.map((entry) => (
                            <span
                                key={entry.path}
                                className="text-[10px] text-muted-foreground truncate font-mono"
                                title={entry.reason}
                            >
                                {entry.path}
                            </span>
                        ))}
                    </Stack>
                ) : null}

                {state.scannedPlugins.length > 0 && state.errors.length === 0 && !state.isScanning ? (
                    <DawMicroBadge tone="success" className="w-fit">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        <span>All plugins scanned successfully</span>
                    </DawMicroBadge>
                ) : null}

                {/*
                 * Steinberg's trademark terms require this attribution wherever
                 * the product names the format. This panel is where a user first
                 * meets it, and it is always rendered so no scan state can hide
                 * it.
                 */}
                <p className="text-[10px] text-muted-foreground">
                    VST® is a registered trademark of Steinberg Media Technologies GmbH.
                </p>
            </Stack>
        </section>
    );
};
