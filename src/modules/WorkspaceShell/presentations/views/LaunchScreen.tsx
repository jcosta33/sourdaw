import { type ReactElement, type DragEvent, useState, useEffect, useRef } from 'react';

import {
    LayoutTemplate,
    Sparkles,
    FolderOpen,
    Upload,
    Download,
    ArrowLeft,
    Music,
    Mic,
    Film,
    FileText,
    Guitar,
    Headphones,
    Piano,
    Layers,
    Clock,
} from 'lucide-react';

import { executeAppAction } from '#/modules/Command/useCases';
import { pickAndImportDawProject } from '#/modules/DawInterchange/useCases';
import {
    newProject,
    createFromTemplate,
    getTemplates,
    getRecentProjects,
    loadRecentProject,
} from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { importDroppedLaunchFiles } from '../../useCases/importDroppedLaunchFiles';
import { SourdawLogo } from '../components/SourdawLogo';

import { TemplatePreviewThumb } from './TemplatePreviewThumb';

// ─────────────────────────────────────────────────────────────
// Constants & metadata
// ─────────────────────────────────────────────────────────────

type View = 'home' | 'grid' | 'loading';

export type LaunchScreenProps = {
    exiting: boolean;
};

type LaunchTemplateCategory = 'empty' | 'music' | 'podcast' | 'film' | 'demo';

type LaunchTemplate = {
    id: string;
    name: string;
    description: string;
    category: LaunchTemplateCategory;
};

const LOADING_QUIPS = [
    'Preheating the oven…',
    'Feeding the starter…',
    'Kneading the dough…',
    'Letting it rise…',
    'Proofing the mix…',
    'Scoring the loaf…',
    'Warming up the crust…',
    'Checking the gluten structure…',
    'Activating the yeast…',
    'Adding a pinch of reverb…',
    'Almost golden brown…',
];

const BREAD_TAGLINES = [
    'Fresh beats, zero preservatives.',
    'Let it rise. Then drop it.',
    'Knead it. Proof it. Ship it.',
    'The best thing since sliced tracks.',
    'Baked from scratch, mixed to perfection.',
    'Your starter is ready.',
    'Good music takes time to proof.',
    'Roll up your sleeves.',
];

const randomTagline = BREAD_TAGLINES[Math.floor(Math.random() * BREAD_TAGLINES.length)] ?? BREAD_TAGLINES[0]!;

const CATEGORY_ORDER: Array<LaunchTemplateCategory | 'all'> = ['all', 'demo', 'music', 'podcast', 'film'];

const CATEGORY_LABELS: Record<string, string> = {
    all: 'All',
    demo: 'Demos',
    music: 'Music',
    podcast: 'Podcast',
    film: 'Film',
};

const CATEGORY_COLORS: Record<string, { text: string; bg: string; activeBg: string; border: string }> = {
    all: { text: 'text-white/60', bg: 'bg-white/5', activeBg: 'bg-white/10', border: 'border-white/10' },
    demo: {
        text: 'text-[var(--color-accent-mint)]',
        bg: 'bg-[var(--color-accent-mint)]/8',
        activeBg: 'bg-[var(--color-accent-mint)]/15',
        border: 'border-[var(--color-accent-mint)]/25',
    },
    music: {
        text: 'text-[var(--color-accent-lavender)]',
        bg: 'bg-[var(--color-accent-lavender)]/8',
        activeBg: 'bg-[var(--color-accent-lavender)]/15',
        border: 'border-[var(--color-accent-lavender)]/25',
    },
    podcast: {
        text: 'text-[var(--color-accent-peach)]',
        bg: 'bg-[var(--color-accent-peach)]/8',
        activeBg: 'bg-[var(--color-accent-peach)]/15',
        border: 'border-[var(--color-accent-peach)]/25',
    },
    film: {
        text: 'text-[var(--color-accent-cyan)]',
        bg: 'bg-[var(--color-accent-cyan)]/8',
        activeBg: 'bg-[var(--color-accent-cyan)]/15',
        border: 'border-[var(--color-accent-cyan)]/25',
    },
    empty: { text: 'text-white/50', bg: 'bg-white/5', activeBg: 'bg-white/10', border: 'border-white/10' },
};

const TEMPLATE_ICONS: Record<string, ReactElement> = {
    empty: <FileText className="size-4" aria-hidden="true" />,
    'basic-band': <Guitar className="size-4" aria-hidden="true" />,
    electronic: <Headphones className="size-4" aria-hidden="true" />,
    podcast: <Mic className="size-4" aria-hidden="true" />,
    'film-score': <Film className="size-4" aria-hidden="true" />,
    'singer-songwriter': <Piano className="size-4" aria-hidden="true" />,
};

// ─────────────────────────────────────────────────────────────
// Sub-components (internal, not exported)
// ─────────────────────────────────────────────────────────────

const AmbientGlows = (): ReactElement => (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
            className="absolute size-[500px] rounded-full blur-3xl opacity-[0.07] -top-20 left-1/4 animate-pulse"
            style={{ background: 'var(--color-accent-orange)', animationDuration: '7s' }}
        />
        <div
            className="absolute size-80 rounded-full blur-3xl opacity-[0.04] bottom-16 right-16 animate-pulse"
            style={{ background: 'var(--color-accent-lavender)', animationDuration: '10s', animationDelay: '3s' }}
        />
        <div
            className="absolute size-56 rounded-full blur-3xl opacity-[0.03] top-1/2 left-8 animate-pulse"
            style={{ background: 'var(--color-accent-cyan)', animationDuration: '13s', animationDelay: '6s' }}
        />
    </div>
);

type RecentProject = ReturnType<typeof getRecentProjects>[number];

const RECENT_PROJECTS_LIMIT = 5;
const PROJECT_ACTIVATION_FAILURE_MESSAGE = 'Failed to create a new project.';
const UNSUPPORTED_DROP_MESSAGE = 'No supported audio or MIDI files were dropped.';

const formatRelativeTime = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (seconds < 60) {
        return 'just now';
    }
    if (minutes < 60) {
        return `${String(minutes)}m ago`;
    }
    if (hours < 24) {
        return `${String(hours)}h ago`;
    }
    if (days < 7) {
        return `${String(days)}d ago`;
    }
    return new Date(timestamp).toLocaleDateString();
};

const LogoBlock = (): ReactElement => (
    <div className="flex flex-col items-center gap-3">
        <div className="relative">
            <div className="absolute inset-0 rounded-full bg-[var(--color-accent-orange)]/20 blur-2xl scale-[2]" />
            <SourdawLogo className="relative h-24 drop-shadow-[0_6px_24px_rgba(217,119,6,0.45)]" />
        </div>
        <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-[var(--color-accent-orange)] via-amber-300 to-[var(--color-accent-peach)] bg-clip-text text-transparent">
                Sourdaw
            </h1>
            <p className="mt-1 text-sm text-white/30 italic">{randomTagline}</p>
        </div>
    </div>
);

// Icon for a category pill. Mirrors the original ternary chain: any category
// other than all/demo/music/podcast (i.e. film) falls back to the Film icon.
const CategoryPillIcon = ({ category }: { category: LaunchTemplateCategory | 'all' }): ReactElement => {
    switch (category) {
        case 'all':
            return <Layers className="size-3" aria-hidden="true" />;
        case 'demo':
            return <Sparkles className="size-3" aria-hidden="true" />;
        case 'music':
            return <Music className="size-3" aria-hidden="true" />;
        case 'podcast':
            return <Mic className="size-3" aria-hidden="true" />;
        default:
            return <Film className="size-3" aria-hidden="true" />;
    }
};

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────

export const LaunchScreen = ({ exiting }: LaunchScreenProps): ReactElement => {
    const [view, setView] = useState<View>('home');
    const [activeCategory, setActiveCategory] = useState<LaunchTemplateCategory | 'all'>('all');
    const [loadingName, setLoadingName] = useState('');
    const [importingDawProject, setImportingDawProject] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [quipIndex, setQuipIndex] = useState(0);
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() =>
        getRecentProjects().slice(0, RECENT_PROJECTS_LIMIT)
    );
    const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

    const allTemplates: LaunchTemplate[] = getTemplates().map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
    }));
    const filteredTemplates =
        activeCategory === 'all' ? allTemplates : allTemplates.filter((t) => t.category === activeCategory);

    // Rotate quips during loading
    useEffect(() => {
        if (view !== 'loading') {
            clearInterval(intervalRef.current);
            return undefined;
        }
        intervalRef.current = setInterval(() => {
            setQuipIndex((i) => (i + 1) % LOADING_QUIPS.length);
        }, 2200);
        return () => clearInterval(intervalRef.current);
    }, [view]);

    // ── Actions ──

    const handleNewProject = (): void => {
        setLoadingName('New Project');
        setView('loading');
        void (async () => {
            if (!(await newProject())) {
                notifyUser(PROJECT_ACTIVATION_FAILURE_MESSAGE, 'error');
                setView('home');
            }
        })();
    };

    const handleImportDawProject = (): void => {
        if (importingDawProject) {
            return;
        }
        // `pickAndImportDawProject` covers both the native file picker and the import
        // itself, and only resolves once the whole thing is done — so before this flag
        // existed the slowest action on the launch screen gave no feedback at all and
        // stayed clickable throughout. The full loading view is wrong here (a native
        // picker may still be up, and the user can cancel it), so the feedback is
        // scoped to the button.
        setImportingDawProject(true);
        // Fire-and-forget: invoked from a click handler with no caller to
        // propagate to; the body resolves to void and has no rejection path
        // worth surfacing beyond the engine's own logging.
        void (async () => {
            try {
                const ok = await pickAndImportDawProject();
                if (!ok) {
                    return;
                }
                setLoadingName('Imported DAWproject');
                setView('loading');
                setRecentProjects(getRecentProjects().slice(0, RECENT_PROJECTS_LIMIT));
            } finally {
                setImportingDawProject(false);
            }
        })();
    };

    const handleExportDawProject = (): void => {
        void executeAppAction({ type: 'exportDawProject' });
    };

    const handleOpenGrid = (category: LaunchTemplateCategory | 'all'): void => {
        setActiveCategory(category);
        setView('grid');
    };

    const handleRecentProjectSelect = (entry: RecentProject): void => {
        setLoadingName(entry.name);
        setView('loading');
        // Fire-and-forget: a click handler returns void; the failure path is
        // handled inline (notifyUser + reset to home) so there is nothing to
        // await or propagate.
        void (async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 80));
            const ok = (await loadRecentProject(entry.key)) === 'committed';
            if (!ok) {
                notifyUser(`Failed to open "${entry.name}"`, 'error');
                setRecentProjects(getRecentProjects().slice(0, RECENT_PROJECTS_LIMIT));
                setView('home');
            }
        })();
    };

    const handleTemplateSelect = (template: LaunchTemplate): void => {
        setLoadingName(template.name);
        setView('loading');
        // Fire-and-forget: the click handler returns void; activation failure
        // is rendered here after the template owner reports its outcome.
        void (async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 80));
            if (!(await createFromTemplate(template.id))) {
                notifyUser(PROJECT_ACTIVATION_FAILURE_MESSAGE, 'error');
                setView('home');
            }
        })();
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        setLoadingName('Importing files…');
        setView('loading');
        const files = Array.from(e.dataTransfer.files);
        // Fire-and-forget: a drop handler returns void; the use-case result
        // carries the per-file failures that this view renders to the user.
        void (async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
            const result = await importDroppedLaunchFiles({ files });
            if (result.status === 'unsupported') {
                notifyUser(UNSUPPORTED_DROP_MESSAGE, 'warning');
                setView('home');
                return;
            }
            if (result.status === 'activation-failed') {
                notifyUser(PROJECT_ACTIVATION_FAILURE_MESSAGE, 'error');
                setView('home');
                return;
            }
            if (result.status === 'superseded') {
                return;
            }
            for (const fileName of result.failedFileNames) {
                notifyUser(`Failed to import "${fileName}"`, 'error');
            }
        })();
    };

    // ── Render ──

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Sourdaw — start a project"
            className="fixed inset-0 z-[9999] overflow-hidden"
            style={{
                transition: 'opacity 0.65s cubic-bezier(0.4,0,0.2,1), transform 0.65s cubic-bezier(0.4,0,0.2,1)',
                opacity: exiting ? 0 : 1,
                transform: exiting ? 'scale(1.03)' : 'scale(1)',
                pointerEvents: exiting ? 'none' : undefined,
                background:
                    'radial-gradient(ellipse at 50% 35%, rgba(217,119,6,0.10) 0%, rgba(0,0,0,0) 65%), hsl(220,14%,5%)',
            }}
            onDragOver={
                view === 'home'
                    ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                          setIsDragOver(true);
                      }
                    : undefined
            }
            onDragLeave={
                view === 'home'
                    ? (e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setIsDragOver(false);
                          }
                      }
                    : undefined
            }
            onDrop={view === 'home' ? handleDrop : undefined}
        >
            <AmbientGlows />

            <div className="flex h-full items-center justify-center p-6">
                {/* ── HOME ── */}
                {view === 'home' ? (
                    <div
                        key="home"
                        className={`animate-in fade-in zoom-in-95 duration-500 relative flex flex-col items-center gap-8 rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] max-w-[440px] w-full p-10 transition-all duration-300 ${
                            isDragOver
                                ? 'border-[var(--color-accent-orange)]/60 bg-[var(--color-accent-orange)]/5 scale-[1.01]'
                                : 'border-white/[0.07] bg-white/[0.03] backdrop-blur-xl'
                        }`}
                    >
                        <LogoBlock />

                        {recentProjects.length > 0 ? (
                            <div className="flex flex-col gap-2 w-full">
                                <div className="flex items-center gap-1.5 px-0.5">
                                    <Clock className="size-3 text-white/35" aria-hidden="true" />
                                    <span className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
                                        Recent Projects
                                    </span>
                                </div>
                                <div
                                    className="flex gap-2 overflow-x-auto scrollbar-thin -mx-1 px-1 pb-1"
                                    role="list"
                                    aria-label="Recent projects"
                                >
                                    {recentProjects.map((entry) => (
                                        <RecentProjectCard
                                            key={entry.key}
                                            entry={entry}
                                            onOpen={handleRecentProjectSelect}
                                        />
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className="grid grid-cols-3 gap-3 w-full">
                            <ActionCard
                                id="launch-new-project"
                                label="New Project"
                                sub="Blank canvas"
                                icon={<FolderOpen className="size-5" aria-hidden="true" />}
                                colorVar="--color-accent-orange"
                                onClick={handleNewProject}
                            />
                            <ActionCard
                                id="launch-from-template"
                                label="Templates"
                                sub="Pre-baked recipes"
                                icon={<LayoutTemplate className="size-5" aria-hidden="true" />}
                                colorVar="--color-accent-lavender"
                                onClick={() => handleOpenGrid('all')}
                            />
                            <ActionCard
                                id="launch-demo-project"
                                label="Demos"
                                sub="Hear what's cooking"
                                icon={<Sparkles className="size-5" aria-hidden="true" />}
                                colorVar="--color-accent-mint"
                                onClick={() => handleOpenGrid('demo')}
                            />
                        </div>

                        <div
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed transition-all w-full justify-center ${
                                isDragOver
                                    ? 'border-[var(--color-accent-orange)] bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)]'
                                    : 'border-white/[0.10] text-white/20'
                            }`}
                        >
                            <Upload className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="text-[11px]">Drop audio or MIDI to start instantly</span>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <button
                                type="button"
                                id="launch-import-dawproject"
                                onClick={handleImportDawProject}
                                disabled={importingDawProject}
                                aria-busy={importingDawProject}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] text-white/45 border border-white/[0.07] hover:border-white/[0.18] hover:text-white/80 transition-colors cursor-pointer disabled:cursor-progress"
                            >
                                <Upload className="size-3" aria-hidden="true" />
                                {importingDawProject ? 'Importing .dawproject…' : 'Import .dawproject'}
                                <span className="text-white/25">from Ableton, Bitwig, Studio One…</span>
                            </button>
                            <button
                                type="button"
                                id="launch-export-dawproject"
                                onClick={handleExportDawProject}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] text-white/45 border border-white/[0.07] hover:border-white/[0.18] hover:text-white/80 transition-colors cursor-pointer"
                            >
                                <Download className="size-3" aria-hidden="true" />
                                Export .dawproject
                            </button>
                        </div>

                        <p className="text-[9px] text-white/12 tracking-wider">Sourdaw Studio · Time to cook</p>
                    </div>
                ) : null}

                {/* ── GRID (Templates / Demos) ── */}
                {view === 'grid' ? (
                    <div
                        key="grid"
                        className="animate-in fade-in slide-in-from-bottom-3 duration-400 flex flex-col gap-4 max-w-[620px] w-full"
                    >
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                aria-label="Back to home"
                                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                                onClick={() => setView('home')}
                            >
                                <ArrowLeft className="size-3.5" aria-hidden="true" />
                                Back
                            </button>
                            <div className="h-3 w-px bg-white/10" />
                            <p className="text-xs text-white/50 font-medium">Start a new project</p>
                        </div>

                        {/* Category pills */}
                        <div className="flex gap-1.5 flex-wrap">
                            {CATEGORY_ORDER.map((cat) => {
                                const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.all!;
                                const isActive = activeCategory === cat;
                                return (
                                    <button
                                        key={cat}
                                        type="button"
                                        onClick={() => setActiveCategory(cat)}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all cursor-pointer ${
                                            isActive
                                                ? `${colors.activeBg} ${colors.text} ${colors.border}`
                                                : 'bg-white/[0.03] text-white/35 border-white/[0.06] hover:bg-white/[0.06] hover:text-white/60'
                                        }`}
                                    >
                                        <CategoryPillIcon category={cat} />
                                        {CATEGORY_LABELS[cat]}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Template grid */}
                        <div className="grid grid-cols-2 gap-2.5 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
                            {filteredTemplates.map((template) => {
                                const colors = CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.empty!;
                                const icon = TEMPLATE_ICONS[template.id] ?? (
                                    <FileText className="size-4" aria-hidden="true" />
                                );
                                return (
                                    <button
                                        key={template.id}
                                        type="button"
                                        onClick={() => handleTemplateSelect(template)}
                                        className={`group flex items-start gap-3 p-4 rounded-xl border transition-all duration-150 cursor-pointer text-left hover:shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:brightness-110 ${colors.border} bg-white/[0.03] hover:bg-white/[0.06] backdrop-blur-sm`}
                                    >
                                        <div
                                            className={`mt-0.5 shrink-0 size-8 rounded-lg ${colors.bg} flex items-center justify-center ${colors.text} transition-colors group-hover:${colors.activeBg}`}
                                        >
                                            {icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-semibold text-white/80 truncate`}>
                                                {template.name}
                                            </p>
                                            <p className={`text-[10px] mt-0.5 ${colors.text}/70 capitalize`}>
                                                {template.category === 'empty' ? 'Blank' : template.category}
                                            </p>
                                            <p className="text-[10px] text-white/30 mt-1 leading-relaxed line-clamp-2">
                                                {template.description}
                                            </p>
                                            <div className="mt-2 overflow-hidden rounded-md border border-white/[0.06]">
                                                <TemplatePreviewThumb templateId={template.id} />
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <p className="text-[9px] text-white/15 text-center">
                            Or drop audio / MIDI files on the home screen to import instantly
                        </p>
                    </div>
                ) : null}

                {/* ── LOADING ── */}
                {view === 'loading' ? (
                    <div
                        key="loading"
                        className="animate-in fade-in zoom-in-95 duration-400 flex flex-col items-center gap-6"
                    >
                        <div className="relative">
                            <div
                                className="absolute inset-0 rounded-full blur-2xl scale-[2.5] opacity-25"
                                style={{ background: 'var(--color-accent-orange)' }}
                            />
                            <SourdawLogo className="relative h-28 drop-shadow-[0_6px_32px_rgba(217,119,6,0.5)]" />
                        </div>
                        <div className="text-center space-y-2">
                            <p className="text-sm font-semibold text-white/80">
                                {loadingName ? (
                                    <>
                                        Baking{' '}
                                        <span className="bg-gradient-to-r from-[var(--color-accent-orange)] to-[var(--color-accent-peach)] bg-clip-text text-transparent">
                                            {loadingName}
                                        </span>
                                    </>
                                ) : (
                                    'Setting up your session…'
                                )}
                            </p>
                            <p
                                key={quipIndex}
                                className="text-xs text-white/35 italic animate-in fade-in slide-in-from-bottom-1 duration-300"
                            >
                                {LOADING_QUIPS[quipIndex]}
                            </p>
                        </div>
                        <div className="w-48 h-px rounded-full overflow-hidden bg-white/5">
                            <div
                                className="h-full w-1/3 rounded-full"
                                style={{
                                    background:
                                        'linear-gradient(90deg, transparent, var(--color-accent-orange), transparent)',
                                    animation: 'ls-shimmer 1.6s ease-in-out infinite',
                                }}
                            />
                        </div>
                        <style>{`@keyframes ls-shimmer { 0%{transform:translateX(-200%)} 100%{transform:translateX(400%)} }`}</style>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

// ─── Shared action card ────────────────────────────────────────────────────

type ActionCardProps = {
    id: string;
    label: string;
    sub: string;
    icon: ReactElement;
    colorVar: string;
    onClick: () => void;
};

const ActionCard = ({ id, label, sub, icon, colorVar, onClick }: ActionCardProps): ReactElement => (
    <button
        type="button"
        id={id}
        className="group flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/[0.07] bg-white/[0.03] transition-all duration-200 cursor-pointer text-center"
        style={{ ['--card-color' as string]: `var(${colorVar})` }}
        onClick={onClick}
        onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = `color-mix(in srgb, var(${colorVar}) 10%, transparent)`;
            (e.currentTarget as HTMLElement).style.borderColor =
                `color-mix(in srgb, var(${colorVar}) 35%, transparent)`;
        }}
        onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = '';
            (e.currentTarget as HTMLElement).style.borderColor = '';
        }}
    >
        <div
            className="size-10 rounded-xl flex items-center justify-center transition-all duration-200"
            style={{ background: `color-mix(in srgb, var(${colorVar}) 15%, transparent)`, color: `var(${colorVar})` }}
        >
            {icon}
        </div>
        <div>
            <span className="text-xs font-semibold text-white/75 block leading-tight">{label}</span>
            <span className="text-[9px] text-white/28 mt-0.5 block">{sub}</span>
        </div>
    </button>
);

// ─── Recent project card ─────────────────────────────────────────────────

type RecentProjectCardProps = {
    entry: RecentProject;
    onOpen: (entry: RecentProject) => void;
};

const RecentProjectCard = ({ entry, onOpen }: RecentProjectCardProps): ReactElement => (
    <button
        type="button"
        aria-label={`Open recent project ${entry.name}`}
        className="shrink-0 flex flex-col items-start gap-1 min-w-[120px] max-w-[160px] p-2.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-left transition-all duration-200 cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.15]"
        onClick={() => onOpen(entry)}
    >
        <div className="flex items-center gap-1.5 w-full min-w-0">
            <FolderOpen className="size-3 shrink-0 text-[var(--color-accent-orange)]/70" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-white/80 truncate">{entry.name}</span>
        </div>
        <span className="text-[9px] text-white/35">{formatRelativeTime(entry.updatedAt)}</span>
    </button>
);
