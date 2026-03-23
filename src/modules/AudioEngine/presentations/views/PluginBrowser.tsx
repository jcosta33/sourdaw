import { type ReactElement, useSyncExternalStore, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Search, ChevronDown, ChevronRight, Plug, RefreshCw, Loader2, Plus, AlertCircle, Monitor } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { pluginScanStore, defaultPluginScanState } from '../../stores/pluginScanStore';
import { startPluginScan } from '#/modules/Plugin/useCases/pluginScanUseCases';
import { type ScannedPlugin } from '#/modules/Plugin/useCases/pluginBridge';
import { createTrackForPlugin, loadExternalPlugin } from '#/modules/Plugin/useCases/pluginBrowserActions';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/helpers/platformCapabilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

type PluginBrowserProps = {
    selectedTrackId: string | null;
    searchQuery: string;
};

const FORMAT_COLORS: Record<string, string> = {
    vst3: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
    clap: 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]',
    au: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
};

const FORMAT_ORDER = ['vst3', 'clap', 'au'];

export const PluginBrowser = ({ selectedTrackId, searchQuery }: PluginBrowserProps): ReactElement | null => {
    const state = useSyncExternalStore(
        (cb) => pluginScanStore.subscribe(cb),
        () => pluginScanStore.value ?? defaultPluginScanState
    );
    const [collapsedFormats, setCollapsedFormats] = useState<Set<string>>(new Set());
    const [localSearch, setLocalSearch] = useState('');

    const { hasNativePlugins } = getPlatformCapabilities();

    if (!hasNativePlugins) {
        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                    <Plug className="size-3 text-muted-foreground" aria-hidden="true" />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">External Plugins</span>
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="px-2 py-3 text-center opacity-50 cursor-not-allowed" aria-disabled="true">
                            <Monitor className="size-5 text-muted-foreground mx-auto mb-1" aria-hidden="true" />
                            <p className="text-[10px] text-muted-foreground">VST / AU / CLAP plugins</p>
                            <p className="text-[9px] text-muted-foreground/60 mt-0.5">Desktop app required</p>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 text-center">
                        {DISABLED_REASONS.nativePlugins}
                    </TooltipContent>
                </Tooltip>
            </div>
        );
    }

    const query = (searchQuery || localSearch).toLowerCase().trim();

    const filtered = state.scannedPlugins.filter((p) => {
        if (!query) {
            return true;
        }
        return (
            p.name.toLowerCase().includes(query) ||
            p.vendor.toLowerCase().includes(query) ||
            p.category.toLowerCase().includes(query)
        );
    });

    const pluginsByFormat = FORMAT_ORDER.map((format) => ({
        format,
        plugins: filtered.filter((p) => p.format.toLowerCase() === format),
    })).filter((group) => group.plugins.length > 0);

    const toggleFormat = (format: string) => {
        setCollapsedFormats((prev) => {
            const next = new Set(prev);
            if (next.has(format)) {
                next.delete(format);
            } else {
                next.add(format);
            }
            return next;
        });
    };

    const handleLoadPlugin = (plugin: ScannedPlugin) => {
        let trackId = selectedTrackId;
        if (!trackId) {
            const isInstrument = plugin.category.toLowerCase() === 'instrument';
            const newTrack = createTrackForPlugin(plugin.name, isInstrument ? 'midi' : 'audio');
            if (!newTrack) {
                return;
            }
            trackId = newTrack.id;
        }
        loadExternalPlugin(trackId, plugin.id, plugin.name);
    };

    const handleScan = () => {
        void startPluginScan();
    };

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                <Plug className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">External Plugins</span>
                <span className="ml-auto text-[9px] text-muted-foreground">{state.scannedPlugins.length}</span>
            </div>

            {state.scannedPlugins.length === 0 && !state.isScanning && (
                <div className="px-2 py-3 text-center">
                    <p className="text-[10px] text-muted-foreground mb-2">No external plugins found.</p>
                    <Button variant="outline" size="xs" className="gap-1 text-[10px]" onClick={handleScan}>
                        <RefreshCw className="size-3" aria-hidden="true" />
                        Scan Plugins
                    </Button>
                </div>
            )}

            {state.isScanning && (
                <div className="flex items-center gap-2 px-2 py-2">
                    <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                    <span className="text-[10px] text-muted-foreground animate-pulse">Scanning for plugins...</span>
                </div>
            )}

            {state.scannedPlugins.length > 0 && (
                <>
                    <div className="flex items-center gap-1 px-1">
                        <div className="flex-1 flex items-center gap-1">
                            <Search className="size-3 text-muted-foreground" aria-hidden="true" />
                            <Input
                                type="search"
                                placeholder="Filter plugins..."
                                value={localSearch}
                                onChange={(e) => {
                                    setLocalSearch(e.target.value);
                                }}
                                className="h-5 border-0 bg-transparent text-[10px] shadow-none focus-visible:ring-0 p-0"
                                aria-label="Filter external plugins"
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={handleScan}
                            disabled={state.isScanning}
                            aria-label="Rescan plugins"
                            title="Rescan plugin directories"
                        >
                            <RefreshCw className={cn('size-3', state.isScanning && 'animate-spin')} />
                        </Button>
                    </div>

                    {pluginsByFormat.map(({ format, plugins }) => {
                        const isCollapsed = collapsedFormats.has(format);
                        return (
                            <div key={format}>
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-1 px-1 py-0.5"
                                    onClick={() => {
                                        toggleFormat(format);
                                    }}
                                >
                                    {isCollapsed ? (
                                        <ChevronRight className="size-3 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="size-3 text-muted-foreground" />
                                    )}
                                    <span
                                        className={cn(
                                            'shrink-0 rounded px-1 py-px text-[10px] font-bold uppercase',
                                            FORMAT_COLORS[format] ?? 'bg-muted text-muted-foreground'
                                        )}
                                    >
                                        {format}
                                    </span>
                                    <span className="ml-auto text-[9px] text-muted-foreground">{plugins.length}</span>
                                </button>
                                {!isCollapsed &&
                                    plugins.map((plugin) => (
                                        <PluginRow
                                            key={plugin.id}
                                            plugin={plugin}
                                            selectedTrackId={selectedTrackId}
                                            onLoad={handleLoadPlugin}
                                        />
                                    ))}
                            </div>
                        );
                    })}

                    {filtered.length === 0 && query && (
                        <p className="px-2 py-2 text-center text-[10px] text-muted-foreground">
                            No plugins match "{query}"
                        </p>
                    )}
                </>
            )}

            {state.errors.length > 0 && !state.isScanning && (
                <div className="px-2 py-1">
                    {state.errors.map((err, i) => (
                        <div key={i} className="flex items-start gap-1 text-[9px] text-destructive">
                            <AlertCircle className="size-3 shrink-0 mt-px" aria-hidden="true" />
                            <span>{err}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const PluginRow = ({
    plugin,
    selectedTrackId,
    onLoad,
}: {
    plugin: ScannedPlugin;
    selectedTrackId: string | null;
    onLoad: (plugin: ScannedPlugin) => void;
}): ReactElement => {
    return (
        <div
            className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer"
            onClick={() => {
                onLoad(plugin);
            }}
            title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                    <span className="text-xs text-foreground truncate">{plugin.name}</span>
                    <span
                        className={cn(
                            'shrink-0 rounded px-1 py-px text-[10px] font-bold uppercase',
                            FORMAT_COLORS[plugin.format.toLowerCase()] ?? 'bg-muted text-muted-foreground'
                        )}
                    >
                        {plugin.format}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-[9px] text-muted-foreground truncate">{plugin.vendor}</span>
                    {plugin.category && (
                        <span className="text-[9px] text-muted-foreground/70 capitalize">· {plugin.category}</span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <span className="text-[9px] text-muted-foreground">{plugin.num_parameters}p</span>
                {selectedTrackId && <Plus className="size-3 text-muted-foreground" />}
            </div>
        </div>
    );
};
