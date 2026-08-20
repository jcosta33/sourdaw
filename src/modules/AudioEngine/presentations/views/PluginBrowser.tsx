import { type ReactElement, useState } from 'react';

import {
    Search,
    ChevronDown,
    ChevronRight,
    Plug,
    RefreshCw,
    Loader2,
    Plus,
    AlertCircle,
    Info,
    Monitor,
} from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { pluginScanStore, defaultPluginScanState, type PluginScanState } from '#/modules/PluginHost/stores';
import { startPluginScan } from '#/modules/PluginHost/useCases';
import { getPlatformCapabilities, DISABLED_REASONS } from '#/utils/platformCapabilities';
import { cn } from '#/utils/Styles/cn';

// A scanned-plugin row, projected from the Plugin store's state contract. The
// Plugin model type stays private (AGENTS.md § Model isolation); this consumer
// reads the shape it renders off the public store-state contract instead.
type ScannedPlugin = PluginScanState['scannedPlugins'][number];

type PluginBrowserProps = {
    selectedTrackId: string | null;
    searchQuery: string;
};

const FORMAT_COLORS: Record<string, string> = {
    clap: 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]',
};

const FORMAT_ORDER = ['clap'];

export const PluginBrowser = ({ selectedTrackId, searchQuery }: PluginBrowserProps): ReactElement | null => {
    const state = useStore(pluginScanStore, defaultPluginScanState);
    const [collapsedFormats, setCollapsedFormats] = useState<Set<string>>(new Set());
    const [localSearch, setLocalSearch] = useState('');

    const { hasNativePlugins } = getPlatformCapabilities();

    if (!hasNativePlugins) {
        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                    <Plug className="size-3 text-muted-foreground" aria-hidden="true" />
                    <DawEyebrowLabel size="sm">External Plugins</DawEyebrowLabel>
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DawEmptyState
                            compact
                            className="cursor-not-allowed opacity-50"
                            icon={<Monitor className="size-5" aria-hidden="true" />}
                            title="CLAP plugins"
                            description="Desktop app required"
                        />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 text-center">
                        {DISABLED_REASONS.nativePlugins}
                    </TooltipContent>
                </Tooltip>
            </div>
        );
    }

    const supportedPlugins = state.scannedPlugins.filter((plugin) => plugin.format.toLowerCase() === 'clap');
    const query = (searchQuery || localSearch).toLowerCase().trim();

    const filtered = supportedPlugins.filter((param) => {
        if (!query) {
            return true;
        }
        return (
            param.name.toLowerCase().includes(query) ||
            param.vendor.toLowerCase().includes(query) ||
            param.category.toLowerCase().includes(query)
        );
    });

    const pluginsByFormat = FORMAT_ORDER.map((format) => ({
        format,
        plugins: filtered.filter((param) => param.format.toLowerCase() === format),
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
        void executeAppAction({
            type: 'loadExternalPlugin',
            payload: { pluginId: plugin.id, ...(selectedTrackId ? { trackId: selectedTrackId } : {}) },
        });
    };

    const handleScan = () => {
        void startPluginScan();
    };

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                <Plug className="size-3 text-muted-foreground" aria-hidden="true" />
                <DawEyebrowLabel size="sm">External Plugins</DawEyebrowLabel>
                <span className="ml-auto text-[9px] text-muted-foreground">{supportedPlugins.length}</span>
            </div>
            {supportedPlugins.length === 0 && !state.isScanning ? (
                <div className="px-2 py-3">
                    <DawEmptyState
                        compact
                        icon={<Plug className="size-4" aria-hidden="true" />}
                        title="No external plugins found"
                        action={
                            <Button variant="outline" size="xs" className="gap-1 text-[10px]" onClick={handleScan}>
                                <RefreshCw className="size-3" aria-hidden="true" />
                                Scan Plugins
                            </Button>
                        }
                    />
                </div>
            ) : null}
            {state.isScanning ? (
                <div className="flex items-center gap-2 px-2 py-2">
                    <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                    <DawInlineHint className="animate-pulse px-0 py-0 text-[10px] text-muted-foreground">
                        Scanning for plugins...
                    </DawInlineHint>
                </div>
            ) : null}
            {supportedPlugins.length > 0 ? (
                <>
                    <div className="flex items-center gap-1 px-1">
                        <div className="flex-1 flex items-center gap-1">
                            <Search className="size-3 text-muted-foreground" aria-hidden="true" />
                            <DawCompactInput
                                type="search"
                                placeholder="Filter plugins..."
                                value={localSearch}
                                onChange={(event) => {
                                    setLocalSearch(event.target.value);
                                }}
                                size="micro"
                                className="h-5 border-0 bg-transparent p-0 text-[10px] shadow-none focus-visible:ring-0"
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
                                    <DawMicroBadge
                                        className={cn(
                                            'shrink-0 border-0 px-1 py-px text-[10px] font-bold uppercase',
                                            FORMAT_COLORS[format] ?? 'bg-muted text-muted-foreground'
                                        )}
                                    >
                                        {format}
                                    </DawMicroBadge>
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

                    {filtered.length === 0 && query ? (
                        <DawInlineHint className="mx-2 flex px-2 py-2 text-[10px] text-muted-foreground/70">
                            No plugins match "{query}"
                        </DawInlineHint>
                    ) : null}
                </>
            ) : null}
            {state.errors.length > 0 && !state.isScanning ? (
                <div className="px-2 py-1">
                    {state.errors.map((err, index) => (
                        <div key={index} className="flex items-start gap-1 text-[9px] text-destructive">
                            <AlertCircle className="size-3 shrink-0 mt-px" aria-hidden="true" />
                            <span>{err}</span>
                        </div>
                    ))}
                </div>
            ) : null}
            {/*
             * Why a plugin the user owns is not in the list above. That is the
             * expected result of a healthy scan, so it reads as muted
             * information rather than as the failure styling directly above it.
             */}
            {state.notices.length > 0 && !state.isScanning ? (
                <div className="px-2 py-1">
                    {state.notices.map((notice) => (
                        <div key={notice} className="flex items-start gap-1 text-[9px] text-muted-foreground">
                            <Info className="size-3 shrink-0 mt-px" aria-hidden="true" />
                            <span>{notice}</span>
                        </div>
                    ))}
                </div>
            ) : null}
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
        <DawPickerRow
            heading={
                <div className="flex items-center gap-1">
                    <span className="truncate">{plugin.name}</span>
                    <DawMicroBadge
                        className={cn(
                            'shrink-0 border-0 px-1 py-px text-[10px] font-bold uppercase',
                            FORMAT_COLORS[plugin.format.toLowerCase()] ?? 'bg-muted text-muted-foreground'
                        )}
                    >
                        {plugin.format}
                    </DawMicroBadge>
                </div>
            }
            description={
                <div className="flex items-center gap-1">
                    <span className="truncate">{plugin.vendor}</span>
                    {plugin.category ? <span className="capitalize">· {plugin.category}</span> : null}
                </div>
            }
            endSlot={
                <div className="flex items-center gap-1 shrink-0">
                    {/*
                     * No parameter count here. CLAP exposes parameters per
                     * instance, so a scan cannot know the number without
                     * creating the plugin — which scanning must not do. The
                     * badge that used to sit here read the scanner's
                     * placeholder and rendered "0p" for every plugin ever
                     * listed, which is worse than showing nothing.
                     */}
                    {selectedTrackId ? <Plus className="size-3 text-muted-foreground" /> : null}
                </div>
            }
            onClick={() => {
                onLoad(plugin);
            }}
            className="px-2 py-1.5"
            title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
        />
    );
};
