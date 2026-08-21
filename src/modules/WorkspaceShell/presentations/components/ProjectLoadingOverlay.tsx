import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Stack } from '#/components/layout';

import { SourdawLogo } from './SourdawLogo';

const LOADING_QUIPS = [
    'Preheating the oven...',
    'Feeding the starter...',
    'Kneading the dough...',
    'Letting it rise...',
    'Proofing the mix...',
    'Scoring the loaf...',
    'Warming up the crust...',
    'Folding in the layers...',
    'Checking the gluten structure...',
    'Dusting with flour...',
    'Shaping the boule...',
    'Adjusting oven spring...',
    'Activating the yeast...',
    'Adding a pinch of reverb...',
    'Measuring the hydration...',
    'Building the crumb...',
    'Almost golden brown...',
    'The aroma is incredible...',
];

/**
 * Full-screen loading overlay shown while the project bootstraps
 * (Faust WASM compilation, device creation, audio graph wiring).
 */
export const ProjectLoadingOverlay = (): ReactElement => {
    const [quipIndex, setQuipIndex] = useState(() => Math.floor(Math.random() * LOADING_QUIPS.length));
    const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setQuipIndex((prev) => (prev + 1) % LOADING_QUIPS.length);
        }, 2500);
        return () => clearInterval(intervalRef.current);
    }, []);

    return (
        <Stack
            align="center"
            justify="center"
            className="fixed inset-0 z-[9999]"
            style={{
                background:
                    'radial-gradient(ellipse at 50% 40%, rgba(217,119,6,0.06) 0%, rgba(0,0,0,0) 60%), hsl(220,14%,8%)',
            }}
        >
            {/* Ambient glow */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                <div
                    className="absolute size-80 rounded-full blur-3xl opacity-[0.04] top-1/4 left-1/3"
                    style={{ background: 'var(--color-accent-orange, #d97706)' }}
                />
                <div
                    className="absolute size-48 rounded-full blur-3xl opacity-[0.03] bottom-1/4 right-1/4 animate-pulse"
                    style={{ background: 'var(--color-accent-lavender, #a78bfa)', animationDuration: '6s' }}
                />
            </div>

            {/* Logo with glow */}
            <div className="relative mb-6">
                <div
                    className="absolute inset-0 rounded-full blur-2xl scale-[2] opacity-30"
                    style={{ background: 'var(--color-accent-orange, #d97706)' }}
                />
                <SourdawLogo className="relative h-28 drop-shadow-[0_4px_20px_rgba(217,119,6,0.4)]" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight mb-3 bg-gradient-to-r from-amber-400 via-amber-300 to-orange-300 bg-clip-text text-transparent">
                Sourdaw
            </h1>

            {/* Revolving message */}
            <p
                key={quipIndex}
                className="text-sm text-white/40 mb-6 h-5 animate-in fade-in slide-in-from-bottom-1 duration-300"
            >
                {LOADING_QUIPS[quipIndex]}
            </p>

            {/* Progress bar */}
            <div className="w-56 h-1 rounded-full overflow-hidden bg-white/5">
                <div
                    className="h-full w-1/3 rounded-full"
                    style={{
                        background: 'linear-gradient(90deg, transparent, rgba(217,119,6,0.6), transparent)',
                        animation: 'loading-shimmer 1.5s ease-in-out infinite',
                    }}
                />
            </div>

            <style>{`
                @keyframes loading-shimmer {
                    0% { transform: translateX(-200%); }
                    100% { transform: translateX(400%); }
                }
            `}</style>
        </Stack>
    );
};
