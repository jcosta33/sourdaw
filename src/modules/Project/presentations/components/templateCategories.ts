import { FileText, Film, Layers, type LucideIcon, Mic, Music, Sparkles } from 'lucide-react';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';

type TemplateCategoryPresentation = {
    /** Label of the filter chip that selects this category. */
    filterLabel: string;
    Icon: LucideIcon;
    /** Card tint: icon tile text and fill, and the card border. */
    text: string;
    bg: string;
    border: string;
    /** Filter chip classes while selected: the tint is the category cue, the label stays foreground for 4.5:1 contrast. */
    chipActive: string;
};

// The one place a category's icon and colors are decided, so a card and its filter chip cannot disagree.
export const TEMPLATE_CATEGORY_PRESENTATION: Record<TemplateCategory, TemplateCategoryPresentation> = {
    empty: {
        filterLabel: 'Blank',
        Icon: FileText,
        text: 'text-muted-foreground',
        bg: 'bg-white/5',
        border: 'border-white/10',
        chipActive: 'border-white/10 bg-white/10 text-foreground',
    },
    demo: {
        filterLabel: 'Demos',
        Icon: Sparkles,
        text: 'text-[var(--color-accent-mint)]',
        bg: 'bg-[var(--color-accent-mint)]/8',
        border: 'border-[var(--color-accent-mint)]/25',
        chipActive: 'border-[var(--color-accent-mint)]/25 bg-[var(--color-accent-mint)]/15 text-foreground',
    },
    music: {
        filterLabel: 'Music',
        Icon: Music,
        text: 'text-[var(--color-accent-lavender)]',
        bg: 'bg-[var(--color-accent-lavender)]/8',
        border: 'border-[var(--color-accent-lavender)]/25',
        chipActive: 'border-[var(--color-accent-lavender)]/25 bg-[var(--color-accent-lavender)]/15 text-foreground',
    },
    podcast: {
        filterLabel: 'Podcast',
        Icon: Mic,
        text: 'text-[var(--color-accent-peach)]',
        bg: 'bg-[var(--color-accent-peach)]/8',
        border: 'border-[var(--color-accent-peach)]/25',
        chipActive: 'border-[var(--color-accent-peach)]/25 bg-[var(--color-accent-peach)]/15 text-foreground',
    },
    film: {
        filterLabel: 'Film',
        Icon: Film,
        text: 'text-[var(--color-accent-cyan)]',
        bg: 'bg-[var(--color-accent-cyan)]/8',
        border: 'border-[var(--color-accent-cyan)]/25',
        chipActive: 'border-[var(--color-accent-cyan)]/25 bg-[var(--color-accent-cyan)]/15 text-foreground',
    },
};

export const ALL_TEMPLATES_FILTER = {
    filterLabel: 'All',
    Icon: Layers,
    chipActive: 'border-white/10 bg-white/10 text-foreground',
} as const;
