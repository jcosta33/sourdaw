import { type ReactElement, useState, useEffect, useRef } from 'react';
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

const CATEGORY_COLORS: Record<TemplateCategory, { text: string; bg: string; border: string }> = {
    empty: { text: 'text-muted-foreground', bg: 'bg-muted/30', border: 'border-border' },
    demo: {
        text: 'text-[var(--color-accent-mint)]',
        bg: 'bg-[var(--color-accent-mint)]/10',
        border: 'border-[var(--color-accent-mint)]/20',
    },
    music: {
        text: 'text-[var(--color-accent-lavender)]',
        bg: 'bg-[var(--color-accent-lavender)]/10',
        border: 'border-[var(--color-accent-lavender)]/20',
    },
    podcast: {
        text: 'text-[var(--color-accent-peach)]',
        bg: 'bg-[var(--color-accent-peach)]/10',
        border: 'border-[var(--color-accent-peach)]/20',
    },
    film: {
        text: 'text-[var(--color-accent-cyan)]',
        bg: 'bg-[var(--color-accent-cyan)]/10',
        border: 'border-[var(--color-accent-cyan)]/20',
    },
};

// Bread-themed loading messages that rotate
const LOADING_MESSAGES = [
    'Preheating the oven...',
    'Measuring the flour...',
    'Adding a pinch of reverb...',
    'Activating the yeast...',
    'Kneading the tracks...',
    'Letting the mix rise...',
    'Sprinkling sesame seeds...',
    'Checking the crust...',
    'Folding in the butter...',
    'Almost golden brown...',
    'The aroma is incredible...',
    'Just a few more minutes...',
];

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
    const colors = CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.empty;
    const isDemo = template.category === 'demo';

    return (
        <button
            type="button"
            disabled={disabled}
            className={`group relative flex flex-col items-start gap-2.5 rounded-xl border p-4 text-left transition-all hover:scale-[1.01] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${colors.border} hover:${colors.border.replace('/20', '/40')} bg-surface-base/50 hover:bg-surface-raised/80`}
            onClick={() => onSelect(template.id)}
        >
            <div className="flex w-full items-center gap-3">
                <div className={`shrink-0 size-9 rounded-lg ${colors.bg} flex items-center justify-center ${colors.text} transition-colors`}>
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate group-hover:text-foreground/90">
                        {template.name}
                    </div>
                    <div className={`text-[10px] font-medium capitalize ${colors.text}/70`}>
                        {template.category === 'empty' ? 'Blank' : template.category}
                    </div>
                </div>
                {isDemo ? (
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                        Demo
                    </span>
                ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                {template.description}
            </p>
        </button>
    );
};

const LoadingState = ({ name }: { name: string }): ReactElement => {
    const [msgIndex, setMsgIndex] = useState(() => Math.floor(Math.random() * LOADING_MESSAGES.length));
    const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setMsgIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
        }, 2200);
        return () => clearInterval(intervalRef.current);
    }, []);

    return (
        <div className="flex flex-col items-center justify-center py-14 gap-5">
            {/* Animated bread icon */}
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full blur-xl scale-[2] opacity-30"
                    style={{ background: 'var(--color-accent-orange, #d97706)' }}
                />
                <img
                    src="/icon-transparent.png"
                    alt=""
                    className="relative h-16 drop-shadow-[0_4px_16px_rgba(217,119,6,0.3)]"
                    style={{ animation: 'tc-bounce 1.2s ease-in-out infinite' }}
                />
            </div>

            <div className="text-center space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                    Baking <span className="bg-gradient-to-r from-[var(--color-accent-orange)] to-[var(--color-accent-peach)] bg-clip-text text-transparent">{name}</span>
                </p>
                <p
                    key={msgIndex}
                    className="text-xs text-muted-foreground/70 italic animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                    {LOADING_MESSAGES[msgIndex]}
                </p>
            </div>

            {/* Progress shimmer */}
            <div className="w-48 h-1 rounded-full overflow-hidden bg-border/20">
                <div
                    className="h-full w-1/3 rounded-full"
                    style={{
                        background: 'linear-gradient(90deg, transparent, var(--color-accent-orange, #d97706), transparent)',
                        animation: 'tc-shimmer 1.5s ease-in-out infinite',
                    }}
                />
            </div>

            <style>{`
                @keyframes tc-bounce {
                    0%, 100% { transform: translateY(0) rotate(0deg); }
                    25% { transform: translateY(-4px) rotate(-2deg); }
                    75% { transform: translateY(-4px) rotate(2deg); }
                }
                @keyframes tc-shimmer {
                    0% { transform: translateX(-200%); }
                    100% { transform: translateX(400%); }
                }
            `}</style>
        </div>
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
            <DialogContent className="sm:max-w-[640px] overflow-hidden">
                <DialogHeader className="pb-0">
                    <div className="flex items-center gap-3">
                        <img src="/icon-transparent.png" alt="" className="h-7 opacity-80" />
                        <div>
                            <DialogTitle className="text-base">
                                {isLoading ? 'Warming up...' : 'Start a new project'}
                            </DialogTitle>
                            <DialogDescription className="text-[11px]">
                                {isLoading
                                    ? 'Setting up tracks, instruments, and effects'
                                    : 'Pick a recipe or start from scratch. Every great loaf begins here.'}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {isLoading ? (
                    <LoadingState name={loadingName} />
                ) : (
                    <>
                        {/* Category filter pills */}
                        <div className="flex gap-1.5 border-b border-border/50 pb-3">
                            <Button
                                variant={activeFilter === 'all' ? 'secondary' : 'ghost'}
                                size="xs"
                                onClick={() => setActiveFilter('all')}
                                className="gap-1"
                            >
                                <Layers className="size-3" aria-hidden="true" />
                                All
                            </Button>
                            {CATEGORY_ORDER.filter((c) => c !== 'empty').map((category) => {
                                const colors = CATEGORY_COLORS[category];
                                const isActive = activeFilter === category;
                                return (
                                    <Button
                                        key={category}
                                        variant={isActive ? 'secondary' : 'ghost'}
                                        size="xs"
                                        onClick={() => setActiveFilter(category)}
                                        className={`gap-1 ${isActive ? colors.text : ''}`}
                                    >
                                        {CATEGORY_ICONS[category]}
                                        <span>{CATEGORY_LABELS[category]}</span>
                                    </Button>
                                );
                            })}
                        </div>

                        {/* Template grid */}
                        <div className="grid grid-cols-2 gap-2.5 max-h-[420px] overflow-y-auto pr-1 py-1">
                            {filtered.map((template) => (
                                <TemplateCard
                                    key={template.id}
                                    template={template}
                                    onSelect={handleSelect}
                                    disabled={isLoading}
                                />
                            ))}
                        </div>

                        {/* Footer hint */}
                        <p className="text-[9px] text-muted-foreground/40 text-center pt-1">
                            You can also drop audio or MIDI files onto the timeline to get started
                        </p>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};
