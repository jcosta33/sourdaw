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
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { pluginScanStore, defaultPluginScanState, type PluginScanState } from '#/modules/PluginHost/stores';
import { SUPPORTED_PLUGIN_FORMATS, isSupportedPluginFormat, startPluginScan } from '#/modules/PluginHost/useCases';
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

// Grouping follows the host's own supported set, so a format the host gains is
// never scanned, offered, and then missing a group to appear in.
const FORMAT_ORDER = SUPPORTED_PLUGIN_FORMATS;

export const PluginBrowser = ({ selectedTrackId, searchQuery }: PluginBrowserProps): ReactElement | null => {
    const state = useStore(pluginScanStore, defaultPluginScanState);
    const [collapsedFormats, setCollapsedFormats] = useState<Set<string>>(new Set());
    const [localSearch, setLocalSearch] = useState('');

    const { hasNativePlugins } = getPlatformCapabilities();

    if (!hasNativePlugins) {
        return (
            <Stack gap={1}>
                <Row gap={1} className="px-1 py-0.5 pt-2">
                    <Plug className="size-3 text-muted-foreground" aria-hidden="true" />
                    <DawEyebrowLabel size="sm">External Plugins</DawEyebrowLabel>
                </Row>
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
            </Stack>
        );
    }

    const supportedPlugins = state.scannedPlugins.filter((plugin) => isSupportedPluginFormat(plugin.format));
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
        <Stack gap={1}>
            <Row gap={1} className="px-1 py-0.5 pt-2">
                <Plug className="size-3 text-muted-foreground" aria-hidden="true" />
                <DawEyebrowLabel size="sm">External Plugins</DawEyebrowLabel>
                <span className="ml-auto text-[9px] text-muted-foreground">{supportedPlugins.length}</span>
            </Row>
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
                <Row gap={2} className="px-2 py-2">
                    <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                    <DawInlineHint className="animate-pulse px-0 py-0 text-[10px] text-muted-foreground">
                        Scanning for plugins...
                    </DawInlineHint>
                </Row>
            ) : null}
            {supportedPlugins.length > 0 ? (
                <>
                    <Row gap={1} className="px-1">
                        <Row grow gap={1}>
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
                        </Row>
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
                    </Row>

                    {pluginsByFormat.map(({ format, plugins }) => {
                        const isCollapsed = collapsedFormats.has(format);
                        return (
                            <div key={format}>
                                <Button
                                    variant="bare"
                                    size="bare"
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
                                </Button>
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
                        <Row align="start" gap={1} className="text-[9px] text-destructive" key={index}>
                            <AlertCircle className="size-3 shrink-0 mt-px" aria-hidden="true" />
                            <span>{err}</span>
                        </Row>
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
                        <Row align="start" gap={1} className="text-[9px] text-muted-foreground" key={notice}>
                            <Info className="size-3 shrink-0 mt-px" aria-hidden="true" />
                            <span>{notice}</span>
                        </Row>
                    ))}
                </div>
            ) : null}
        </Stack>
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
                <Row gap={1}>
                    <span className="truncate">{plugin.name}</span>
                    <DawMicroBadge
                        className={cn(
                            'shrink-0 border-0 px-1 py-px text-[10px] font-bold uppercase',
                            FORMAT_COLORS[plugin.format.toLowerCase()] ?? 'bg-muted text-muted-foreground'
                        )}
                    >
                        {plugin.format}
                    </DawMicroBadge>
                </Row>
            }
            description={
                <Row gap={1}>
                    <span className="truncate">{plugin.vendor}</span>
                    {plugin.category ? <span className="capitalize">· {plugin.category}</span> : null}
                </Row>
            }
            endSlot={
                <Row gap={1} shrink={false}>
                    {/*
                     * No parameter count here. CLAP exposes parameters per
                     * instance, so a scan cannot know the number without
                     * creating the plugin — which scanning must not do. The
                     * badge that used to sit here read the scanner's
                     * placeholder and rendered "0p" for every plugin ever
                     * listed, which is worse than showing nothing.
                     */}
                    {selectedTrackId ? <Plus className="size-3 text-muted-foreground" /> : null}
                </Row>
            }
            onClick={() => {
                onLoad(plugin);
            }}
            className="px-2 py-1.5"
            title={selectedTrackId ? 'Click to load onto selected track' : 'Click to create a new track'}
        />
    );
};
