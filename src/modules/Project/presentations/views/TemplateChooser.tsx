import { type ReactElement, useState, useEffect } from 'react';
import { Music, Mic, Film, FileText, Layers, Guitar, Piano, Headphones, Sparkles, Loader2 } from 'lucide-react';
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
    disabled,
}: {
    template: ProjectTemplate;
    onSelect: (id: string) => void;
    disabled?: boolean;
}): ReactElement => {
    const icon = TEMPLATE_ICONS[template.id] ?? <FileText className="size-5" aria-hidden="true" />;
    const categoryColor = getCategoryColor(template.category);

    return (
        <button
            type="button"
            disabled={disabled}
            className="group flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-ring hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none"
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
    const [isLoading, setIsLoading] = useState(false);
    const [loadingName, setLoadingName] = useState('');
    const templates = getTemplates();

    useEffect(() => {
        if (open) {
            setActiveFilter(initialCategory);
            setIsLoading(false);
        }
    }, [open, initialCategory]);

    const filtered = activeFilter === 'all' ? templates : templates.filter((t) => t.category === activeFilter);

    const handleSelect = (templateId: string) => {
        const template = templates.find((t) => t.id === templateId);
        setLoadingName(template?.name ?? 'Project');
        setIsLoading(true);
        saveProject();

        // Use setTimeout to allow the loading UI to render before the heavy sync work
        setTimeout(() => {
            void (async () => {
                try {
                    await createFromTemplate(templateId);
                } finally {
                    setIsLoading(false);
                    onClose();
                }
            })();
        }, 50);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen && !isLoading) {
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

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                        <Loader2 className="size-8 text-primary animate-spin" />
                        <div className="text-center">
                            <p className="text-sm font-medium text-foreground">Loading {loadingName}…</p>
                            <p className="text-xs text-muted-foreground mt-1">Compiling instruments and effects</p>
                        </div>
                    </div>
                ) : (
                    <>
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
                                <TemplateCard key={template.id} template={template} onSelect={handleSelect} disabled={isLoading} />
                            ))}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};
