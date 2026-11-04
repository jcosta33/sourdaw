import { type ReactElement, useState } from 'react';

import { type DawFilterChipOption, DawFilterChipGroup } from '#/components/daw/DawFilterChipGroup';
import { Grid, Stack } from '#/components/layout';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';
import { TemplateCard, type TemplateCardTemplate } from '../components/TemplateCard';
import { ALL_TEMPLATES_FILTER, TEMPLATE_CATEGORY_PRESENTATION } from '../components/templateCategories';

import { TemplatePreviewThumb } from './TemplatePreviewThumb';

type GalleryFilter = TemplateCategory | 'all';

type TemplateGalleryProps = {
    templates: readonly TemplateCardTemplate[];
    onSelect: (templateId: string) => void;
    initialCategory?: GalleryFilter;
    disabled?: boolean;
};

const FILTER_ORDER = ['demo', 'music', 'podcast', 'film'] as const satisfies readonly TemplateCategory[];

const FILTER_OPTIONS: readonly DawFilterChipOption<GalleryFilter>[] = [
    {
        value: 'all',
        label: ALL_TEMPLATES_FILTER.filterLabel,
        icon: <ALL_TEMPLATES_FILTER.Icon className="size-3" aria-hidden="true" />,
        activeClassName: ALL_TEMPLATES_FILTER.chipActive,
    },
    ...FILTER_ORDER.map((category): DawFilterChipOption<GalleryFilter> => {
        const { filterLabel, Icon, chipActive } = TEMPLATE_CATEGORY_PRESENTATION[category];
        return {
            value: category,
            label: filterLabel,
            icon: <Icon className="size-3" aria-hidden="true" />,
            activeClassName: chipActive,
        };
    }),
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
                className="max-h-[420px] overflow-x-hidden overflow-y-auto p-1 [scrollbar-gutter:stable]"
            >
                {visible.map((template) => (
                    <TemplateCard
                        key={template.id}
                        template={template}
                        preview={<TemplatePreviewThumb templateId={template.id} />}
                        onSelect={onSelect}
                        disabled={disabled}
                    />
                ))}
            </Grid>
        </Stack>
    );
};
