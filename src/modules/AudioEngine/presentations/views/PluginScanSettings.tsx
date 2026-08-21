import { type ReactElement, useState } from 'react';

import {
    FolderOpen,
    Trash2,
    RefreshCw,
    Loader2,
    Plus,
    AlertCircle,
    CheckCircle2,
    Info,
    Plug,
    Monitor,
} from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { pluginScanStore, defaultPluginScanState } from '#/modules/PluginHost/stores';
import { startPluginScan, addScanPath, removeScanPath } from '#/modules/PluginHost/useCases';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/utils/platformCapabilities';

export const PluginScanSettings = (): ReactElement | null => {
    const state = useStore(pluginScanStore, defaultPluginScanState);
    const [newPath, setNewPath] = useState('');

    const { hasPluginScanning } = getPlatformCapabilities();

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

    const handleAddPath = () => {
        const trimmed = newPath.trim();
        if (trimmed) {
            addScanPath(trimmed);
            setNewPath('');
        }
    };

    const handleScan = () => {
        void startPluginScan();
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

                <Row gap={1}>
                    <DawCompactInput
                        type="text"
                        placeholder="/path/to/plugins..."
                        value={newPath}
                        onChange={(event) => {
                            setNewPath(event.target.value);
                        }}
                        className="flex-1"
                        monospace
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                handleAddPath();
                            }
                        }}
                    />
                    <Button
                        variant="outline"
                        size="xs"
                        onClick={handleAddPath}
                        disabled={!newPath.trim()}
                        aria-label="Add plugin path"
                    >
                        <Plus className="size-3" />
                    </Button>
                </Row>

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

                {state.scannedPlugins.length > 0 && state.errors.length === 0 && !state.isScanning ? (
                    <DawMicroBadge tone="success" className="w-fit">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        <span>All plugins scanned successfully</span>
                    </DawMicroBadge>
                ) : null}
            </Stack>
        </section>
    );
};
