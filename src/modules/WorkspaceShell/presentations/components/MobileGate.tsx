import { type ReactElement, type ReactNode, useState } from 'react';

import { Bug, MessageCircle } from 'lucide-react';

import { Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { PROJECT_LINKS } from '../projectLinks';

import { SourdawLogo } from './SourdawLogo';

const TABLET_SCREEN_FLOOR = 1024;

/**
 * Deliberate, test-guarded rule: a device is an unsupported phone iff its primary
 * pointer is coarse and neither `screen` axis reaches the 1024 CSS px tablet floor.
 * Platform identity carries this decision where window width cannot: every modern
 * phone pushes `innerWidth` past 768 in landscape, while desktop zoom, docked
 * DevTools, or a dragged-narrow window pull it below — and taking the max over both
 * screen axes keeps the answer identical in every orientation. The floor keeps
 * phones (iPhone 15 is 393×852 CSS px, 15 Pro Max ~440×956) gated while the iPad
 * mini (744×1133) and larger tablets stay eligible; a fine-pointer desktop is never
 * gated, whatever its window size.
 */
function isUnsupportedPhone(): boolean {
    const largestScreenDimension = Math.max(window.screen.width, window.screen.height);
    return window.matchMedia('(pointer: coarse)').matches && largestScreenDimension < TABLET_SCREEN_FLOOR;
}

type MobileGateProps = {
    children: ReactNode;
};

export const MobileGate = ({ children }: MobileGateProps): ReactElement => {
    // Latched at first evaluation: the gate owns `AppShell`'s mount, so a decision
    // that flipped mid-session would unmount a running shell and discard undo
    // history and non-CRDT state. No resize or orientation event may reopen it.
    const [shouldShowMobileGate] = useState(isUnsupportedPhone);

    if (!shouldShowMobileGate) {
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

                <Stack gap={2} className="w-full">
                    <Button
                        asChild
                        variant="bare"
                        size="bare"
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-[var(--color-accent-orange)]/25 bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)] transition-all duration-200 cursor-pointer hover:bg-[var(--color-accent-orange)]/20 hover:border-[var(--color-accent-orange)]/40"
                    >
                        <a href={PROJECT_LINKS.discussions} target="_blank" rel="noopener noreferrer">
                            <MessageCircle className="size-4" aria-hidden="true" />
                            <span className="text-xs font-semibold">Discussions</span>
                        </a>
                    </Button>
                    <Button
                        asChild
                        variant="bare"
                        size="bare"
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-white/[0.07] bg-white/[0.05] text-white/70 transition-all duration-200 cursor-pointer hover:bg-white/[0.1] hover:text-white"
                    >
                        <a href={PROJECT_LINKS.issues} target="_blank" rel="noopener noreferrer">
                            <Bug className="size-4" aria-hidden="true" />
                            <span className="text-xs font-semibold">Report a bug</span>
                        </a>
                    </Button>
                </Stack>
            </Stack>
        </Stack>
    );
};
