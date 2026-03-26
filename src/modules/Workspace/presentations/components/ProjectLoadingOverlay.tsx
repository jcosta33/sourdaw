import { type ReactElement } from 'react';

/**
 * Full-screen loading overlay shown while the project bootstraps
 * (Faust WASM compilation, device creation, audio graph wiring).
 */
export const ProjectLoadingOverlay = (): ReactElement => {
    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[hsl(220,14%,8%)]">
            {/* Pulsing ring animation */}
            <div className="relative mb-8">
                <div className="size-16 rounded-full border-2 border-white/10 animate-ping absolute inset-0" />
                <div className="size-16 rounded-full border-2 border-white/20 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="size-7 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                    </svg>
                </div>
            </div>

            <h1 className="text-lg font-semibold text-white/80 tracking-wide mb-2">
                WebDAW
            </h1>
            <p className="text-sm text-white/40 animate-pulse">
                Loading project…
            </p>

            {/* Subtle gradient bar */}
            <div className="mt-6 w-48 h-0.5 rounded-full overflow-hidden bg-white/5">
                <div
                    className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    style={{
                        animation: 'shimmer 1.5s ease-in-out infinite',
                    }}
                />
            </div>

            <style>{`
                @keyframes shimmer {
                    0% { transform: translateX(-150%); }
                    100% { transform: translateX(450%); }
                }
            `}</style>
        </div>
    );
};
