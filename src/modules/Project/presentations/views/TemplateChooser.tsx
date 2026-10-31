import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Row, Stack } from '#/components/layout';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '#/components/ui/dialog';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';
import { pendingProjectReplacements } from '../../useCases/projectPersistence/pendingProjectReplacements';
import { saveProjectBeforeReplacement } from '../../useCases/projectPersistence/saveProject/saveProjectBeforeReplacement';
import { createFromTemplate } from '../../useCases/projectTemplates/templateDefinitions/createFromTemplate';
import { getTemplates } from '../../useCases/projectTemplates/templateDefinitions/getTemplates';

import { TemplateGallery } from './TemplateGallery';

// Inlined from WorkspaceShell/presentations/components/SourdawLogo to avoid
// cross-module private-presentation import.
type SourdawLogoProps = {
    className?: string;
    paused?: boolean;
};

type ParticleDef = {
    src: string;
    x: number;
    y: number;
    w: number;
    h: number;
    dir: 'up' | 'down';
    delay: number;
    duration: number;
};

const LOAF = { src: '/logo-parts/loaf.png', x: 66, y: 176, w: 345, h: 164 };

const PARTICLES: ParticleDef[] = [
    { src: '/logo-parts/p01.png', x: 228, y: 102, w: 21, h: 48, dir: 'up', delay: 0.0, duration: 3.0 },
    { src: '/logo-parts/p05.png', x: 228, y: 56, w: 21, h: 38, dir: 'up', delay: 0.5, duration: 3.4 },
    { src: '/logo-parts/p16.png', x: 229, y: 24, w: 20, h: 20, dir: 'up', delay: 1.0, duration: 3.8 },
    { src: '/logo-parts/p07.png', x: 187, y: 93, w: 21, h: 32, dir: 'up', delay: 0.2, duration: 2.8 },
    { src: '/logo-parts/p12.png', x: 188, y: 134, w: 20, h: 20, dir: 'up', delay: 0.7, duration: 2.6 },
    { src: '/logo-parts/p30.png', x: 188, y: 75, w: 20, h: 10, dir: 'up', delay: 1.2, duration: 3.2 },
    { src: '/logo-parts/p08.png', x: 269, y: 93, w: 20, h: 32, dir: 'up', delay: 0.3, duration: 2.8 },
    { src: '/logo-parts/p11.png', x: 269, y: 134, w: 20, h: 21, dir: 'up', delay: 0.8, duration: 2.6 },
    { src: '/logo-parts/p29.png', x: 269, y: 74, w: 20, h: 12, dir: 'up', delay: 1.3, duration: 3.2 },
    { src: '/logo-parts/p03.png', x: 152, y: 122, w: 20, h: 41, dir: 'up', delay: 0.4, duration: 3.0 },
    { src: '/logo-parts/p19.png', x: 152, y: 78, w: 20, h: 19, dir: 'up', delay: 0.9, duration: 3.4 },
    { src: '/logo-parts/p31.png', x: 155, y: 105, w: 17, h: 10, dir: 'up', delay: 1.5, duration: 3.6 },
    { src: '/logo-parts/p04.png', x: 305, y: 123, w: 20, h: 40, dir: 'up', delay: 0.4, duration: 3.0 },
    { src: '/logo-parts/p18.png', x: 305, y: 78, w: 20, h: 20, dir: 'up', delay: 1.0, duration: 3.4 },
    { src: '/logo-parts/p32.png', x: 305, y: 105, w: 16, h: 9, dir: 'up', delay: 1.6, duration: 3.6 },
    { src: '/logo-parts/p06.png', x: 112, y: 140, w: 20, h: 38, dir: 'up', delay: 0.6, duration: 3.2 },
    { src: '/logo-parts/p15.png', x: 113, y: 113, w: 20, h: 19, dir: 'up', delay: 1.1, duration: 3.6 },
    { src: '/logo-parts/p02.png', x: 344, y: 126, w: 20, h: 52, dir: 'up', delay: 0.7, duration: 3.2 },
    { src: '/logo-parts/p22.png', x: 77, y: 170, w: 20, h: 19, dir: 'up', delay: 1.4, duration: 3.8 },
    { src: '/logo-parts/p21.png', x: 380, y: 170, w: 19, h: 19, dir: 'up', delay: 1.4, duration: 3.8 },
    { src: '/logo-parts/p00.png', x: 228, y: 364, w: 21, h: 87, dir: 'down', delay: 0.1, duration: 3.2 },
    { src: '/logo-parts/p28.png', x: 188, y: 364, w: 21, h: 12, dir: 'down', delay: 0.3, duration: 2.6 },
    { src: '/logo-parts/p25.png', x: 188, y: 384, w: 20, h: 16, dir: 'down', delay: 0.6, duration: 2.8 },
    { src: '/logo-parts/p26.png', x: 188, y: 409, w: 20, h: 16, dir: 'down', delay: 0.9, duration: 3.0 },
    { src: '/logo-parts/p27.png', x: 268, y: 364, w: 21, h: 12, dir: 'down', delay: 0.3, duration: 2.6 },
    { src: '/logo-parts/p23.png', x: 269, y: 384, w: 20, h: 16, dir: 'down', delay: 0.7, duration: 2.8 },
    { src: '/logo-parts/p24.png', x: 268, y: 408, w: 21, h: 17, dir: 'down', delay: 1.0, duration: 3.0 },
    { src: '/logo-parts/p09.png', x: 152, y: 364, w: 20, h: 28, dir: 'down', delay: 0.5, duration: 2.9 },
    { src: '/logo-parts/p14.png', x: 152, y: 405, w: 20, h: 19, dir: 'down', delay: 1.0, duration: 3.3 },
    { src: '/logo-parts/p10.png', x: 305, y: 364, w: 20, h: 28, dir: 'down', delay: 0.5, duration: 2.9 },
    { src: '/logo-parts/p13.png', x: 305, y: 405, w: 20, h: 20, dir: 'down', delay: 1.0, duration: 3.3 },
    { src: '/logo-parts/p17.png', x: 113, y: 365, w: 20, h: 19, dir: 'down', delay: 1.2, duration: 3.5 },
    { src: '/logo-parts/p20.png', x: 344, y: 365, w: 19, h: 19, dir: 'down', delay: 1.2, duration: 3.5 },
];

const CANVAS_W = 480;
const CANVAS_H = 480;

const SourdawLogo = ({ className, paused }: SourdawLogoProps): ReactElement => {
    const styleBlock = paused
        ? ''
        : PARTICLES.map((_, index) => {
              const param = PARTICLES[index]!;
              const dist = param.dir === 'up' ? -20 : 20;
              return `
@keyframes sdl-p${index} {
  0% { opacity: 0; transform: translateY(0) scale(0.4); }
  12% { opacity: 1; transform: translateY(0) scale(1); }
  65% { opacity: 0.8; transform: translateY(${dist * 0.6}px) scale(0.95); }
  100% { opacity: 0; transform: translateY(${dist}px) scale(0.5); }
}`;
          }).join('\n');

    return (
        <div
            className={className}
            style={{ position: 'relative', aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
            role="img"
            aria-label="Sourdaw logo"
        >
            {!paused ? <style>{styleBlock}</style> : null}
            <img
                src={LOAF.src}
                alt=""
                draggable={false}
                style={{
                    position: 'absolute',
                    left: `${(LOAF.x / CANVAS_W) * 100}%`,
                    top: `${(LOAF.y / CANVAS_H) * 100}%`,
                    width: `${(LOAF.w / CANVAS_W) * 100}%`,
                    height: `${(LOAF.h / CANVAS_H) * 100}%`,
                    imageRendering: 'auto',
                }}
            />
            {PARTICLES.map((param, index) => (
                <img
                    key={index}
                    src={param.src}
                    alt=""
                    draggable={false}
                    style={{
                        position: 'absolute',
                        left: `${(param.x / CANVAS_W) * 100}%`,
                        top: `${(param.y / CANVAS_H) * 100}%`,
                        width: `${(param.w / CANVAS_W) * 100}%`,
                        height: `${(param.h / CANVAS_H) * 100}%`,
                        imageRendering: 'auto',
                        ...(paused
                            ? { opacity: 1 }
                            : {
                                  opacity: 0,
                                  animation: `sdl-p${index} ${param.duration}s ease-in-out ${param.delay}s infinite`,
                              }),
                    }}
                />
            ))}
        </div>
    );
};

type TemplateChooserProps = {
    open: boolean;
    onClose: () => void;
    initialCategory?: TemplateCategory | 'all';
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
        <Stack align="center" justify="center" className="py-14 gap-5">
            {/* Animated bread icon */}
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full blur-xl scale-[2] opacity-30"
                    style={{ background: 'var(--color-accent-orange, #d97706)' }}
                />
                <SourdawLogo className="relative h-20 drop-shadow-[0_4px_16px_rgba(217,119,6,0.3)]" />
            </div>

            <Stack gap={1.5} className="text-center">
                <p className="text-sm font-semibold text-foreground">
                    Baking{' '}
                    <span className="bg-gradient-to-r from-[var(--color-accent-orange)] to-[var(--color-accent-peach)] bg-clip-text text-transparent">
                        {name}
                    </span>
                </p>
                <p
                    key={msgIndex}
                    className="text-xs text-muted-foreground/70 italic animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                    {LOADING_MESSAGES[msgIndex]}
                </p>
            </Stack>

            {/* Progress shimmer */}
            <div className="w-48 h-1 rounded-full overflow-hidden bg-border/20">
                <div
                    className="h-full w-1/3 rounded-full"
                    style={{
                        background:
                            'linear-gradient(90deg, transparent, var(--color-accent-orange, #d97706), transparent)',
                        animation: 'tc-shimmer 1.5s ease-in-out infinite',
                    }}
                />
            </div>

            <style>{`
                @keyframes tc-shimmer {
                    0% { transform: translateX(-200%); }
                    100% { transform: translateX(400%); }
                }
            `}</style>
        </Stack>
    );
};

export const TemplateChooser = ({ open, onClose, initialCategory = 'all' }: TemplateChooserProps): ReactElement => {
    const [isLoading, setIsLoading] = useState(false);
    const [loadingName, setLoadingName] = useState('');
    const templates = getTemplates();

    const [prevOpen, setPrevOpen] = useState(open);
    if (prevOpen !== open) {
        setPrevOpen(open);
        if (open) {
            setIsLoading(false);
        }
    }

    const handleSelect = (templateId: string) => {
        const template = templates.find((time) => time.id === templateId);
        setLoadingName(template?.name ?? 'Project');
        setIsLoading(true);
        const isStillChosen = pendingProjectReplacements.capture();

        void (async () => {
            try {
                // Await the pre-switch save (audit #568 F2); abort on a failed
                // save or on a save that resolved with the project still dirty
                // — a plugin capture rejected before commit keeps that edit
                // uncaptured, and the template would destroy it. Both refusal
                // surfaces already notified; the current project stays open.
                // Choosing the open project meanwhile withdraws the template.
                if (!(await saveProjectBeforeReplacement()) || !isStillChosen()) {
                    return;
                }
                await createFromTemplate(templateId, { shouldProceed: isStillChosen });
            } finally {
                setIsLoading(false);
                onClose();
            }
        })();
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
                    <Row gap={3}>
                        <SourdawLogo className="h-7 opacity-80" paused />
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
                    </Row>
                </DialogHeader>

                {isLoading ? (
                    <LoadingState name={loadingName} />
                ) : (
                    <>
                        <TemplateGallery
                            templates={templates}
                            initialCategory={initialCategory}
                            onSelect={handleSelect}
                            disabled={isLoading}
                        />

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
