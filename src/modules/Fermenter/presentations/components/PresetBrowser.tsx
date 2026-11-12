/**
 * Preset Browser — proper navigation with search, tags, categories.
 * Replaces the single select dropdown with a full browsing experience.
 */
import { type ReactElement, useState } from 'react';

import { Search, Star, ChevronRight } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only the fields this browser renders.
type SoundPreset = {
    id: string;
    name: string;
    category: string;
    tags?: string[];
};

type PresetBrowserProps = {
    currentName: string;
    userPatches: Array<{ id: string; name: string }>;
    presets: SoundPreset[];
    onLoadPreset: (presetId: string) => void;
};

const CATEGORIES = [
    { id: 'all', label: 'All', icon: null },
    { id: 'user', label: 'My Patches', color: 'var(--color-accent-peach)' },
    { id: 'synth', label: 'Synth', color: 'var(--color-accent-lavender)' },
    { id: 'bass', label: 'Bass', color: 'var(--color-state-danger)' },
    { id: 'lead', label: 'Lead', color: 'var(--color-accent-peach)' },
    { id: 'pad', label: 'Pad', color: 'var(--color-accent-cyan)' },
    { id: 'keys', label: 'Keys', color: 'var(--color-accent-mint)' },
    { id: 'strings', label: 'Strings', color: 'var(--color-accent-lavender)' },
    { id: 'drums', label: 'Drums', color: 'var(--color-accent-peach)' },
    { id: 'fx', label: 'FX', color: 'var(--color-accent-lavender)' },
];

const TAGS = [
    'fermenter',
    'analog',
    'fm',
    'physical',
    'granular',
    'additive',
    'acid',
    'warm',
    'aggressive',
    'ambient',
    'unison',
    'warp',
    'moog',
    'diode',
];

export const PresetBrowser = ({
    currentName,
    userPatches,
    presets,
    onLoadPreset,
}: PresetBrowserProps): ReactElement => {
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);

    // React Compiler handles memoization automatically — no useMemo needed
    let filtered =
        category === 'user'
            ? userPatches.map((p) => ({ id: p.id, name: p.name, category: 'user', tags: [] as string[] }))
            : presets.map((p) => ({
                  id: p.id,
                  name: p.name.replace('Fermenter — ', ''),
                  category: p.category,
                  tags: p.tags || [],
              }));

    if (category !== 'all' && category !== 'user') {
        filtered = filtered.filter((p) => p.category === category);
    }

    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
            (p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
        );
    }

    if (selectedTag) {
        filtered = filtered.filter((p) => p.tags.includes(selectedTag));
    }

    return (
        <Stack className="h-full">
            {/* Search */}
            <div className="relative px-2 py-1.5 shrink-0">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search presets…"
                    className="w-full h-6 rounded border border-border/40 bg-surface-inset pl-7 pr-2 text-[length:var(--text-nano)] text-foreground outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70 focus:border-[var(--color-accent-lavender)]"
                />
            </div>
            {/* Category pills */}
            <Row
                align="stretch"
                wrap={false}
                gap={0.5}
                shrink={false}
                className="overflow-x-auto no-scrollbar px-2 py-1 border-b border-border/20"
            >
                {CATEGORIES.map((cat) => {
                    let pillStyle: React.CSSProperties | undefined = undefined;
                    if (category === cat.id && cat.color) {
                        pillStyle = { backgroundColor: cat.color, color: 'var(--color-surface-panel)' };
                    } else if (category === cat.id) {
                        pillStyle = {
                            backgroundColor: 'var(--color-accent-lavender)',
                            color: 'var(--color-surface-panel)',
                        };
                    }

                    return (
                        <Button
                            variant="bare"
                            size="bare"
                            key={cat.id}
                            type="button"
                            aria-pressed={category === cat.id}
                            className={`min-h-6 shrink-0 whitespace-nowrap rounded px-2 text-[length:var(--text-nano)] font-medium transition-colors ${
                                category === cat.id
                                    ? 'text-surface-panel'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            style={pillStyle}
                            onClick={() => {
                                setCategory(cat.id);
                                setSelectedTag(null);
                            }}
                        >
                            {cat.id === 'user' ? <Star className="mr-0.5 inline size-2.5" /> : null}
                            {cat.label}
                        </Button>
                    );
                })}
            </Row>
            {/* Tag filter (contextual) */}
            {category !== 'user' ? (
                <Row align="stretch" wrap gap={0.5} shrink={false} className="px-2 py-0.5">
                    {TAGS.filter((tag) => {
                        // Only show tags that have matching presets in current category
                        return filtered.some((p) => p.tags.includes(tag));
                    })
                        .slice(0, 10)
                        .map((tag) => (
                            <Button
                                variant="bare"
                                size="bare"
                                key={tag}
                                type="button"
                                aria-pressed={selectedTag === tag}
                                className={`min-h-6 min-w-6 rounded px-1.5 text-[length:var(--text-nano)] transition-colors ${
                                    selectedTag === tag
                                        ? 'bg-muted text-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                            >
                                #{tag}
                            </Button>
                        ))}
                </Row>
            ) : null}
            {/* Preset list */}
            <div className="min-h-[140px] flex-1 overflow-y-auto px-1 py-0.5">
                {filtered.length === 0 ? (
                    <div className="text-center text-[9px] text-muted-foreground/50 py-6">No presets found</div>
                ) : (
                    filtered.map((preset) => (
                        <Button
                            variant="bare"
                            size="bare"
                            key={preset.id}
                            type="button"
                            className={`flex min-h-6 w-full items-center justify-between rounded px-2 text-left text-[length:var(--text-nano)] transition-all ${
                                preset.name === currentName || preset.name === currentName.replace('Fermenter — ', '')
                                    ? 'bg-[var(--color-accent-lavender)]/15 text-foreground'
                                    : 'text-text-secondary hover:bg-surface-raised hover:text-foreground'
                            }`}
                            onClick={() => onLoadPreset(preset.id)}
                        >
                            <span className="truncate font-medium">{preset.name}</span>
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                        </Button>
                    ))
                )}
            </div>
            <div className="px-2 py-0.5 border-t border-border/20 shrink-0">
                <span className="text-[7px] text-muted-foreground/40">{filtered.length} presets</span>
            </div>
        </Stack>
    );
};
