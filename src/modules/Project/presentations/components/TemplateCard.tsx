import { type ReactElement } from 'react';

import { FileText, Film, Guitar, Headphones, Mic, Piano } from 'lucide-react';

import { cn } from '#/utils/Styles/cn';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';

import { TemplatePreviewThumb } from './TemplatePreviewThumb';

export type TemplateCardTemplate = {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
};

type TemplateCardProps = {
    template: TemplateCardTemplate;
    onSelect: (templateId: string) => void;
    disabled?: boolean;
};

type CategoryTint = { text: string; bg: string; border: string };

const CATEGORY_TINTS: Record<TemplateCategory, CategoryTint> = {
    empty: { text: 'text-white/50', bg: 'bg-white/5', border: 'border-white/10' },
    demo: {
        text: 'text-[var(--color-accent-mint)]',
        bg: 'bg-[var(--color-accent-mint)]/8',
        border: 'border-[var(--color-accent-mint)]/25',
    },
    music: {
        text: 'text-[var(--color-accent-lavender)]',
        bg: 'bg-[var(--color-accent-lavender)]/8',
        border: 'border-[var(--color-accent-lavender)]/25',
    },
    podcast: {
        text: 'text-[var(--color-accent-peach)]',
        bg: 'bg-[var(--color-accent-peach)]/8',
        border: 'border-[var(--color-accent-peach)]/25',
    },
    film: {
        text: 'text-[var(--color-accent-cyan)]',
        bg: 'bg-[var(--color-accent-cyan)]/8',
        border: 'border-[var(--color-accent-cyan)]/25',
    },
};

const TEMPLATE_ICONS: Record<string, ReactElement> = {
    empty: <FileText className="size-4" aria-hidden="true" />,
    'basic-band': <Guitar className="size-4" aria-hidden="true" />,
    electronic: <Headphones className="size-4" aria-hidden="true" />,
    podcast: <Mic className="size-4" aria-hidden="true" />,
    'film-score': <Film className="size-4" aria-hidden="true" />,
    'singer-songwriter': <Piano className="size-4" aria-hidden="true" />,
};

const FALLBACK_ICON = <FileText className="size-4" aria-hidden="true" />;

// A native button on purpose: the shared Button primitive sets whitespace-nowrap, which keeps a
// long description from wrapping and pushes it past the card edge.
export const TemplateCard = ({ template, onSelect, disabled = false }: TemplateCardProps): ReactElement => {
    const tint = CATEGORY_TINTS[template.category];

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
                {TEMPLATE_ICONS[template.id] ?? FALLBACK_ICON}
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white/80">{template.name}</p>
                <p className={cn('mt-0.5 text-[10px] capitalize', tint.text)}>
                    {template.category === 'empty' ? 'Blank' : template.category}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/30">{template.description}</p>
                <div className="mt-2 overflow-hidden rounded-md border border-white/[0.06]">
                    <TemplatePreviewThumb templateId={template.id} />
                </div>
            </div>
        </button>
    );
};
