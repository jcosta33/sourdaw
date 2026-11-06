import { type ReactElement, type ReactNode } from 'react';

import { cn } from '#/utils/Styles/cn';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';

import { TEMPLATE_CATEGORY_PRESENTATION } from './templateCategories';

export type TemplateCardTemplate = {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
};

type TemplateCardProps = {
    template: TemplateCardTemplate;
    preview: ReactNode;
    onSelect: (templateId: string) => void;
    disabled?: boolean;
};

// A native button on purpose: the shared Button primitive sets whitespace-nowrap, which keeps a
// long description from wrapping and pushes it past the card edge.
export const TemplateCard = ({ template, preview, onSelect, disabled = false }: TemplateCardProps): ReactElement => {
    const tint = TEMPLATE_CATEGORY_PRESENTATION[template.category];
    const { Icon } = tint;

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(template.id)}
            className={cn(
                'group flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border bg-white/[0.03] p-4 text-left outline-none transition-all duration-150',
                'hover:bg-white/[0.06] hover:shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:brightness-110',
                'focus-visible:ring-1 focus-visible:ring-border-focus/70 disabled:pointer-events-none disabled:opacity-50',
                tint.border
            )}
        >
            <div
                className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', tint.bg, tint.text)}
            >
                <Icon className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{template.name}</p>
                <p className={cn('mt-0.5 text-[10px] capitalize', tint.text)}>
                    {template.category === 'empty' ? 'Blank' : template.category}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {template.description}
                </p>
                <div className="mt-2 overflow-hidden rounded-md border border-white/[0.06]">{preview}</div>
            </div>
        </button>
    );
};
