import { type ReactElement, useState } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Search, Music, Headphones, FileAudio, Star } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";

type BrowserTab = "samples" | "instruments" | "presets" | "favorites";

const TABS: { id: BrowserTab; label: string; Icon: typeof FileAudio }[] = [
    { id: "samples", label: "Samples", Icon: FileAudio },
    { id: "instruments", label: "Instruments", Icon: Music },
    { id: "presets", label: "Presets", Icon: Headphones },
    { id: "favorites", label: "Favorites", Icon: Star },
];

const TAB_DESCRIPTIONS: Record<BrowserTab, string> = {
    samples: "Drag samples here to browse your audio files.",
    instruments: "Browse available instruments and plugins.",
    presets: "Browse presets for your instruments and effects.",
    favorites: "Your favorited items will appear here.",
};

export const Sidebar = (): ReactElement => {
    const [activeTab, setActiveTab] = useState<BrowserTab>("samples");
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <aside
            className="flex w-(--spacing-sidebar-width) shrink-0 flex-col border-r border-border/50 bg-surface-raised"
            aria-label="Browser panel"
        >
            <div className="flex items-center gap-1 border-b border-border/50 p-2">
                <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                    type="search"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-6 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
                    aria-label="Search browser"
                />
            </div>

            <div className="flex border-b border-border/50" role="tablist" aria-label="Browser categories">
                {TABS.map((tab) => (
                    <Button
                        key={tab.id}
                        variant="ghost"
                        size="xs"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`browser-panel-${tab.id}`}
                        className={cn(
                            "flex-1 rounded-none",
                            activeTab === tab.id && "bg-accent",
                        )}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <tab.Icon className="size-3.5" aria-hidden="true" />
                    </Button>
                ))}
            </div>

            <ScrollArea className="flex-1">
                <div
                    id={`browser-panel-${activeTab}`}
                    role="tabpanel"
                    className="p-2"
                    aria-label={`${activeTab} browser`}
                >
                    {searchQuery.trim() ? (
                        <p className="text-xs text-muted-foreground">
                            No results for &quot;{searchQuery}&quot;
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            {TAB_DESCRIPTIONS[activeTab]}
                        </p>
                    )}
                </div>
            </ScrollArea>
        </aside>
    );
};
