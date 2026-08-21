/**
 * Preset Browser — proper navigation with search, tags, categories.
 * Replaces the single select dropdown with a full browsing experience.
 */
import { type ReactElement, useState } from 'react';

import { Search, Star, ChevronRight } from 'lucide-react';

import { Row, Stack } from '#/components/layout';

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
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search presets…"
                    className="w-full h-6 rounded border border-border/40 bg-surface-inset pl-7 pr-2 text-[9px] text-foreground outline-none focus:border-[var(--color-accent-lavender)]"
                />
            </div>
            {/* Category pills */}
            <Row align="stretch" wrap gap={0.5} shrink={false} className="px-2 py-1 border-b border-border/20">
                {CATEGORIES.map((cat) => {
                    let pillStyle: React.CSSProperties | undefined = undefined;
                    if (category === cat.id && cat.color) {
                        pillStyle = { backgroundColor: cat.color };
                    } else if (category === cat.id) {
                        pillStyle = { backgroundColor: 'var(--color-accent-lavender)' };
                    }

                    return (
                        <button
                            key={cat.id}
                            type="button"
                            className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${
                                category === cat.id ? 'text-white' : 'text-muted-foreground/60 hover:text-foreground'
                            }`}
                            style={pillStyle}
                            onClick={() => {
                                setCategory(cat.id);
                                setSelectedTag(null);
                            }}
                        >
                            {cat.id === 'user' ? <Star className="size-2.5 inline mr-0.5" /> : null}
                            {cat.label}
                        </button>
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
                            <button
                                key={tag}
                                type="button"
                                className={`px-1 py-0 rounded text-[6px] transition-colors ${
                                    selectedTag === tag
                                        ? 'bg-muted text-foreground'
                                        : 'text-muted-foreground/40 hover:text-muted-foreground'
                                }`}
                                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                            >
                                #{tag}
                            </button>
                        ))}
                </Row>
            ) : null}
            {/* Preset list */}
            <div className="flex-1 overflow-y-auto px-1 py-0.5">
                {filtered.length === 0 ? (
                    <div className="text-center text-[9px] text-muted-foreground/50 py-6">No presets found</div>
                ) : (
                    filtered.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            className={`w-full flex items-center justify-between px-2 py-1 rounded text-left transition-all ${
                                preset.name === currentName || preset.name === currentName.replace('Fermenter — ', '')
                                    ? 'bg-[var(--color-accent-lavender)]/15 text-foreground'
                                    : 'hover:bg-surface-raised text-foreground/80'
                            }`}
                            onClick={() => onLoadPreset(preset.id)}
                        >
                            <span className="text-[9px] font-medium truncate">{preset.name}</span>
                            <ChevronRight className="size-3 text-muted-foreground/30 shrink-0" />
                        </button>
                    ))
                )}
            </div>
            <div className="px-2 py-0.5 border-t border-border/20 shrink-0">
                <span className="text-[7px] text-muted-foreground/40">{filtered.length} presets</span>
            </div>
        </Stack>
    );
};
