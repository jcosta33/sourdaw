import { type ReactElement, useSyncExternalStore, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { FolderOpen, Trash2, RefreshCw, Loader2, Plus, AlertCircle, CheckCircle2, Plug, Monitor } from 'lucide-react';
import { pluginScanStore, defaultPluginScanState } from '../../stores/pluginScanStore';
import { startPluginScan, addScanPath, removeScanPath } from '#/modules/Plugin/useCases/pluginScanUseCases';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/helpers/platformCapabilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

export const PluginScanSettings = (): ReactElement | null => {
    const state = useSyncExternalStore(
        (cb) => pluginScanStore.subscribe(cb),
        () => pluginScanStore.value ?? defaultPluginScanState
    );
    const [newPath, setNewPath] = useState('');

    const { hasPluginScanning } = getPlatformCapabilities();

    if (!hasPluginScanning) {
        return (
            <section>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Plug className="size-3" aria-hidden="true" />
                    Plugin Paths
                </label>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div
                            className="flex items-center gap-2 rounded-md border border-border/30 bg-surface-overlay/30 px-3 py-3 opacity-50 cursor-not-allowed"
                            aria-disabled="true"
                        >
                            <Monitor className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
                            <div>
                                <p className="text-[10px] text-muted-foreground">Plugin scanning unavailable</p>
                                <p className="text-[9px] text-muted-foreground/60">Desktop app required</p>
                            </div>
                        </div>
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
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Plug className="size-3" aria-hidden="true" />
                Plugin Paths
            </label>

            <div className="space-y-2">
                {state.scanPaths.length > 0 && (
                    <div className="space-y-1">
                        {state.scanPaths.map((path) => (
                            <div key={path} className="flex items-center gap-1.5 group">
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
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-1">
                    <Input
                        type="text"
                        placeholder="/path/to/plugins..."
                        value={newPath}
                        onChange={(e) => {
                            setNewPath(e.target.value);
                        }}
                        className="h-7 text-xs flex-1 font-mono"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
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
                </div>

                <div className="flex items-center gap-2">
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

                    <div className="flex-1 text-right">
                        <span className="text-[10px] text-muted-foreground">
                            {state.scannedPlugins.length} plugins found
                        </span>
                    </div>
                </div>

                <div className="text-[10px] text-muted-foreground">Last scan: {lastScanLabel}</div>

                {state.errors.length > 0 && (
                    <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                        {state.errors.map((err, i) => (
                            <div key={i} className="flex items-start gap-1 text-[10px] text-destructive">
                                <AlertCircle className="size-3 shrink-0 mt-px" aria-hidden="true" />
                                <span>{err}</span>
                            </div>
                        ))}
                    </div>
                )}

                {state.scannedPlugins.length > 0 && state.errors.length === 0 && !state.isScanning && (
                    <div className="flex items-center gap-1 text-[10px] text-[var(--color-state-success)]">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        <span>All plugins scanned successfully</span>
                    </div>
                )}
            </div>
        </section>
    );
};
