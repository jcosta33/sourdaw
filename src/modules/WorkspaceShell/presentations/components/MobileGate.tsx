import { type ReactElement, type ReactNode, useState, useEffect } from 'react';

import { Stack } from '#/components/layout';

import { SourdawLogo } from './SourdawLogo';

// SVG Discord icon (same as AlphaNoticeDialog)
const DiscordIcon = ({ className }: { className?: string }): ReactElement => (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" className={className}>
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
);

const MOBILE_BREAKPOINT = 768;

/**
 * Reports whether the viewport is too small to run the DAW.
 *
 * The result is **monotonic**: it can go mobile → desktop, never back. This gate
 * decides whether `AppShell` mounts at all, so flipping back to mobile would unmount
 * a running shell and re-run its boot effects — and `loadProject` ends in
 * `clearUndoHistory()`, so the user's undo stack and non-CRDT module state would be
 * silently discarded. Ordinary desktop actions cross 768 CSS px mid-session: browser
 * zoom at 175–200%, docking DevTools to the side, dragging the Sourdaw desktop app
 * window narrow. The
 * mobile → desktop direction stays live because the shell has not mounted yet, so
 * there is no session to lose and a window that starts narrow can still recover.
 *
 * The cost is not symmetric, and it is not trivial. A desktop user who narrows the
 * window gets a cramped layout, which is recoverable. But every modern phone exceeds
 * 768 CSS px in landscape — iPhone 15 is 852, 15 Pro Max 932, Pixel 8 about 892 — so
 * one rotation mounts `AppShell` and boots the engine, project load, MIDI and autosave
 * on a phone, and rotating back to portrait leaves an unusable full DAW at 393 px with
 * no notice and no way back short of a reload. Before the gate owned the shell's mount
 * it was reactive both ways and this could not happen. `(pointer: coarse)` is not the
 * fix: it would gate an iPad mini in portrait at 744 px, and the notice copy explicitly
 * supports tablets.
 */
function useIsMobile(): boolean {
    const [isDesktopViewport, setIsDesktopViewport] = useState(() => window.innerWidth >= MOBILE_BREAKPOINT);

    useEffect(() => {
        if (isDesktopViewport) {
            return undefined;
        }

        const mq = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`);
        if (mq.matches) {
            setIsDesktopViewport(true);
            return undefined;
        }

        const handler = (event: MediaQueryListEvent): void => {
            if (event.matches) {
                setIsDesktopViewport(true);
            }
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [isDesktopViewport]);

    return !isDesktopViewport;
}

type MobileGateProps = {
    children: ReactNode;
};

export const MobileGate = ({ children }: MobileGateProps): ReactElement => {
    const isMobile = useIsMobile();

    if (!isMobile) {
        return <>{children}</>;
    }

    return (
        <Stack
            align="center"
            justify="center"
            className="fixed inset-0 z-[9999] p-6"
            style={{
                background:
                    'radial-gradient(ellipse at 50% 40%, rgba(217,119,6,0.06) 0%, rgba(0,0,0,0) 60%), hsl(220,14%,8%)',
            }}
        >
            {/* Ambient glows */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                <div
                    className="absolute size-[300px] rounded-full blur-3xl opacity-[0.08] -top-10 left-1/4 animate-pulse"
                    style={{ background: 'var(--color-accent-orange)', animationDuration: '7s' }}
                />
                <div
                    className="absolute size-48 rounded-full blur-3xl opacity-[0.05] bottom-12 right-8 animate-pulse"
                    style={{
                        background: 'var(--color-accent-lavender)',
                        animationDuration: '10s',
                        animationDelay: '3s',
                    }}
                />
            </div>

            {/* Card */}
            <Stack
                align="center"
                gap={6}
                className="relative rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] p-8 text-center max-w-[340px] w-full"
            >
                {/* Logo & title */}
                <Stack align="center" gap={4}>
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-[var(--color-accent-orange)]/20 blur-2xl scale-[2]" />
                        <SourdawLogo className="relative h-20 drop-shadow-[0_6px_24px_rgba(217,119,6,0.45)]" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white/90">
                            <span className="bg-gradient-to-r from-[var(--color-accent-orange)] via-amber-300 to-[var(--color-accent-peach)] bg-clip-text text-transparent">
                                Sourdaw
                            </span>
                        </h1>
                        <p className="mt-1 text-[11px] font-semibold text-[var(--color-accent-peach)] uppercase tracking-widest">
                            Desktop DAW
                        </p>
                    </div>
                </Stack>

                {/* Message */}
                <Stack gap={2}>
                    <p className="text-sm font-semibold text-white/80 leading-snug">
                        This dough needs more room to rise.
                    </p>
                    <p className="text-sm text-white/50 leading-relaxed">
                        Sourdaw is crafted for desktop or tablet. Open it on a larger screen to start baking your next
                        track.
                    </p>
                </Stack>

                {/* Discord CTA */}
                <button
                    type="button"
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-[var(--color-accent-orange)]/25 bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)] transition-all duration-200 cursor-pointer hover:bg-[var(--color-accent-orange)]/20 hover:border-[var(--color-accent-orange)]/40"
                    onClick={() => window.open('https://discord.gg/bJHmmfY4', '_blank')}
                >
                    <DiscordIcon className="size-4" />
                    <span className="text-xs font-semibold">Join the Bakery on Discord</span>
                </button>
            </Stack>
        </Stack>
    );
};
