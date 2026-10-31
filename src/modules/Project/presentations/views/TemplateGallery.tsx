import { type ReactElement, useState } from 'react';

import { Film, Layers, Mic, Music, Sparkles } from 'lucide-react';

import { type DawFilterChipOption, DawFilterChipGroup } from '#/components/daw/DawFilterChipGroup';
import { Grid, Stack } from '#/components/layout';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';
import { TemplateCard, type TemplateCardTemplate } from '../components/TemplateCard';

type GalleryFilter = TemplateCategory | 'all';

type TemplateGalleryProps = {
    templates: readonly TemplateCardTemplate[];
    onSelect: (templateId: string) => void;
    initialCategory?: GalleryFilter;
    disabled?: boolean;
};

const FILTER_OPTIONS: readonly DawFilterChipOption<GalleryFilter>[] = [
    {
        value: 'all',
        label: 'All',
        icon: <Layers className="size-3" aria-hidden="true" />,
        activeClassName: 'border-white/10 bg-white/10 text-white/60',
    },
    {
        value: 'demo',
        label: 'Demos',
        icon: <Sparkles className="size-3" aria-hidden="true" />,
        activeClassName:
            'border-[var(--color-accent-mint)]/25 bg-[var(--color-accent-mint)]/15 text-[var(--color-accent-mint)]',
    },
    {
        value: 'music',
        label: 'Music',
        icon: <Music className="size-3" aria-hidden="true" />,
        activeClassName:
            'border-[var(--color-accent-lavender)]/25 bg-[var(--color-accent-lavender)]/15 text-[var(--color-accent-lavender)]',
    },
    {
        value: 'podcast',
        label: 'Podcast',
        icon: <Mic className="size-3" aria-hidden="true" />,
        activeClassName:
            'border-[var(--color-accent-peach)]/25 bg-[var(--color-accent-peach)]/15 text-[var(--color-accent-peach)]',
    },
    {
        value: 'film',
        label: 'Film',
        icon: <Film className="size-3" aria-hidden="true" />,
        activeClassName:
            'border-[var(--color-accent-cyan)]/25 bg-[var(--color-accent-cyan)]/15 text-[var(--color-accent-cyan)]',
    },
];

export const TemplateGallery = ({
    templates,
    onSelect,
    initialCategory = 'all',
    disabled = false,
}: TemplateGalleryProps): ReactElement => {
    const [category, setCategory] = useState<GalleryFilter>(initialCategory);
    const visible = category === 'all' ? templates : templates.filter((template) => template.category === category);

    return (
        <Stack gap={3}>
            <DawFilterChipGroup
                label="Template category"
                options={FILTER_OPTIONS}
                value={category}
                onValueChange={setCategory}
            />
            <Grid
                cols={2}
                gap={2.5}
                className="max-h-[420px] overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
            >
                {visible.map((template) => (
                    <TemplateCard key={template.id} template={template} onSelect={onSelect} disabled={disabled} />
                ))}
            </Grid>
        </Stack>
    );
};
