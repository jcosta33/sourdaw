import React, { type ReactElement, useState } from 'react';
import { Music, Mic, Film, FileText, Layers, Guitar, Piano, Headphones, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import {
    getTemplates,
    createFromTemplate,
    type TemplateCategory,
    type ProjectTemplate,
} from '../../useCases/projectTemplates';
import { saveProject } from '../../useCases/projectPersistence';

type TemplateChooserProps = {
    open: boolean;
    onClose: () => void;
    initialCategory?: TemplateCategory | 'all';
};

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
    empty: 'All',
    music: 'Music',
    podcast: 'Podcast',
    film: 'Film',
    demo: 'Demos',
};

const CATEGORY_ORDER: TemplateCategory[] = ['empty', 'demo', 'music', 'podcast', 'film'];

const TEMPLATE_ICONS: Record<string, ReactElement> = {
    empty: <FileText className="size-5" aria-hidden="true" />,
    'basic-band': <Guitar className="size-5" aria-hidden="true" />,
    electronic: <Headphones className="size-5" aria-hidden="true" />,
    podcast: <Mic className="size-5" aria-hidden="true" />,
    'film-score': <Film className="size-5" aria-hidden="true" />,
    'singer-songwriter': <Piano className="size-5" aria-hidden="true" />,
};

const CATEGORY_ICONS: Record<TemplateCategory, ReactElement> = {
    empty: <Layers className="size-3.5" aria-hidden="true" />,
    demo: <Sparkles className="size-3.5" aria-hidden="true" />,
    music: <Music className="size-3.5" aria-hidden="true" />,
    podcast: <Mic className="size-3.5" aria-hidden="true" />,
    film: <Film className="size-3.5" aria-hidden="true" />,
};

const getCategoryColor = (category: TemplateCategory): string => {
    switch (category) {
        case 'demo':
            return 'text-[var(--color-accent-mint)]';
        case 'music':
            return 'text-[var(--color-accent-lavender)]';
        case 'podcast':
            return 'text-[var(--color-accent-peach)]';
        case 'film':
            return 'text-[var(--color-accent-cyan)]';
        default:
            return 'text-muted-foreground';
    }
};

const TemplateCard = ({
    template,
    onSelect,
}: {
    template: ProjectTemplate;
    onSelect: (id: string) => void;
}): ReactElement => {
    const icon = TEMPLATE_ICONS[template.id] ?? <FileText className="size-5" aria-hidden="true" />;
    const categoryColor = getCategoryColor(template.category);

    return (
        <button
            type="button"
            className="group flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-ring hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
                onSelect(template.id);
            }}
        >
            <div className="flex w-full items-center gap-3">
                <div className={`shrink-0 ${categoryColor}`}>{icon}</div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{template.name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{template.category}</div>
                </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{template.description}</p>
        </button>
    );
};

export const TemplateChooser = ({ open, onClose, initialCategory = 'all' }: TemplateChooserProps): ReactElement => {
    const [activeFilter, setActiveFilter] = useState<TemplateCategory | 'all'>(initialCategory);
    const templates = getTemplates();

    React.useEffect(() => {
        if (open) {
            setActiveFilter(initialCategory);
        }
    }, [open, initialCategory]);

    const filtered = activeFilter === 'all' ? templates : templates.filter((t) => t.category === activeFilter);

    const handleSelect = (templateId: string) => {
        saveProject();
        createFromTemplate(templateId);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onClose();
                }
            }}
        >
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>New from Template</DialogTitle>
                    <DialogDescription>
                        Choose a template to start your project with pre-configured tracks and devices.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-1.5 border-b border-border pb-3">
                    <Button
                        variant={activeFilter === 'all' ? 'secondary' : 'ghost'}
                        size="xs"
                        onClick={() => {
                            setActiveFilter('all');
                        }}
                    >
                        <Layers className="size-3.5 mr-1" aria-hidden="true" />
                        All
                    </Button>
                    {CATEGORY_ORDER.filter((c) => c !== 'empty').map((category) => (
                        <Button
                            key={category}
                            variant={activeFilter === category ? 'secondary' : 'ghost'}
                            size="xs"
                            onClick={() => {
                                setActiveFilter(category);
                            }}
                        >
                            {CATEGORY_ICONS[category]}
                            <span className="ml-1">{CATEGORY_LABELS[category]}</span>
                        </Button>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
                    {filtered.map((template) => (
                        <TemplateCard key={template.id} template={template} onSelect={handleSelect} />
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
};
