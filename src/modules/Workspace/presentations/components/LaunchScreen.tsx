import { type ReactElement, type DragEvent, useState, useEffect, useRef } from 'react';

import {
    LayoutTemplate,
    Sparkles,
    FolderOpen,
    Upload,
    ArrowLeft,
    Music,
    Mic,
    Film,
    FileText,
    Guitar,
    Headphones,
    Piano,
    Layers,
} from 'lucide-react';

import { addTrack, addClip, importMidiFile } from '#/modules/Arrangement/useCases';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { newProject, createFromTemplate, getTemplates } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { SourdawLogo } from './SourdawLogo';

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

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────

export const LaunchScreen = ({ exiting }: LaunchScreenProps): ReactElement => {
    const [view, setView] = useState<View>('home');
    const [activeCategory, setActiveCategory] = useState<LaunchTemplateCategory | 'all'>('all');
    const [loadingName, setLoadingName] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [quipIndex, setQuipIndex] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

    const allTemplates: LaunchTemplate[] = getTemplates().map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
    }));
    const filteredTemplates =
        activeCategory === 'all' ? allTemplates : allTemplates.filter((time) => time.category === activeCategory);

    // Rotate quips during loading
    useEffect(() => {
        if (view !== 'loading') {
            clearInterval(intervalRef.current);
        } else {
            intervalRef.current = setInterval(() => {
                setQuipIndex((index) => (index + 1) % LOADING_QUIPS.length);
            }, 2200);
        }
        return () => clearInterval(intervalRef.current);
    }, [view]);

    // ── Actions ──

    const handleNewProject = (): void => {
        setLoadingName('New Project');
        setView('loading');
        // Let the loading animation render before synchronous work
        setTimeout(() => {
            newProject();
        }, 280);
    };

    const handleOpenGrid = (category: LaunchTemplateCategory | 'all'): void => {
        setActiveCategory(category);
        setView('grid');
    };

    const handleTemplateSelect = (template: LaunchTemplate): void => {
        setLoadingName(template.name);
        setView('loading');
        void (async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 80));
            await createFromTemplate(template.id);
        })();
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        setLoadingName('Importing files…');
        setView('loading');
        void (async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
            newProject();
            for (const file of Array.from(event.dataTransfer.files)) {
                const ext = file.name.toLowerCase().split('.').pop() ?? '';
                if (['mid', 'midi'].includes(ext) || file.type === 'audio/midi') {
                    await importMidiFile(file);
                    continue;
                }
                const isAudio =
                    file.type.startsWith('audio/') ||
                    ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'aiff', 'aif'].includes(ext);
                if (!isAudio) {
                    continue;
                }
                const track = addTrack({ name: file.name.replace(/\.[^.]+$/, ''), kind: 'audio' });
                if (!track) {
                    continue;
                }
                try {
                    const { id: bufferId, buffer } = await decodeAudioFile(file);
                    const tempo = transportStore.value?.tempo ?? 120;
                    const beats = Math.max(4, Math.ceil((buffer.duration / 60) * tempo));
                    addClip({
                        trackId: track.id,
                        startBeat: 0,
                        endBeat: beats,
                        name: file.name.replace(/\.[^.]+$/, ''),
                        type: 'audio',
                        audioBufferId: bufferId,
                    });
                } catch {
                    notifyUser(`Failed to import "${file.name}"`, 'error');
                }
            }
        })();
    };

    // ── Render ──
    const renderIife_2 = () => {
        if (view === 'home') {
            return (
                <div
                    key="home"
                    className={`animate-in fade-in zoom-in-95 duration-500 relative flex flex-col items-center gap-8 rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] max-w-[440px] w-full p-10 transition-all duration-300 ${
                        isDragOver
                            ? 'border-[var(--color-accent-orange)]/60 bg-[var(--color-accent-orange)]/5 scale-[1.01]'
                            : 'border-white/[0.07] bg-white/[0.03] backdrop-blur-xl'
                    }`}
                >
                    <LogoBlock />
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
                    <p className="text-[9px] text-white/12 tracking-wider">Sourdaw Studio · Time to cook</p>
                </div>
            );
        } else {
            return null;
        }
    };
    const renderIife_3 = () => {
        if (view === 'grid') {
            return (
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
                            const renderIife_4 = () => {
                                if (cat === 'all') {
                                    return <Layers className="size-3" aria-hidden="true" />;
                                } else {
                                    if (cat === 'demo') {
                                        return <Sparkles className="size-3" aria-hidden="true" />;
                                    } else {
                                        if (cat === 'music') {
                                            return <Music className="size-3" aria-hidden="true" />;
                                        } else {
                                            if (cat === 'podcast') {
                                                return <Mic className="size-3" aria-hidden="true" />;
                                            } else {
                                                return <Film className="size-3" aria-hidden="true" />;
                                            }
                                        }
                                    }
                                }
                            };

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
                                    {renderIife_4()}
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
                                    <div className="min-w-0">
                                        <p className={`text-xs font-semibold text-white/80 truncate`}>
                                            {template.name}
                                        </p>
                                        <p className={`text-[10px] mt-0.5 ${colors.text}/70 capitalize`}>
                                            {template.category === 'empty' ? 'Blank' : template.category}
                                        </p>
                                        <p className="text-[10px] text-white/30 mt-1 leading-relaxed line-clamp-2">
                                            {template.description}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[9px] text-white/15 text-center">
                        Or drop audio / MIDI files on the home screen to import instantly
                    </p>
                </div>
            );
        } else {
            return null;
        }
    };

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
                    ? (event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'copy';
                          setIsDragOver(true);
                      }
                    : undefined
            }
            onDragLeave={
                view === 'home'
                    ? (event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
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
                {renderIife_2()}

                {/* ── GRID (Templates / Demos) ── */}
                {renderIife_3()}

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
        onMouseEnter={(event) => {
            (event.currentTarget as HTMLElement).style.background =
                `color-mix(in srgb, var(${colorVar}) 10%, transparent)`;
            (event.currentTarget as HTMLElement).style.borderColor =
                `color-mix(in srgb, var(${colorVar}) 35%, transparent)`;
        }}
        onMouseLeave={(event) => {
            (event.currentTarget as HTMLElement).style.background = '';
            (event.currentTarget as HTMLElement).style.borderColor = '';
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
