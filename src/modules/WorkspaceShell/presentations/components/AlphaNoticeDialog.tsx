import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent } from '#/components/ui/dialog';

import { SourdawLogo } from './SourdawLogo';

export type AlphaNoticeDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

// SVG Discord icon
const DiscordIcon = ({ className }: { className?: string }): ReactElement => (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" className={className}>
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
);

export const AlphaNoticeDialog = ({ open, onOpenChange }: AlphaNoticeDialogProps): ReactElement => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* 
              We use a custom DialogContent styling to match the LaunchScreen.
              We strip out the default border/bg and apply the custom glassmorphism
              and glow effects from the LaunchScreen component.
            */}
            <DialogContent className="max-w-[480px] p-0 border-0 bg-transparent shadow-none overflow-visible">
                {/* Ambient glow behind the modal */}
                <div
                    className="pointer-events-none absolute inset-0 overflow-hidden"
                    aria-hidden="true"
                    style={{ zIndex: -1 }}
                >
                    <div
                        className="absolute size-[300px] rounded-full blur-3xl opacity-[0.1] -top-10 left-1/4 animate-pulse"
                        style={{ background: 'var(--color-accent-orange)', animationDuration: '7s' }}
                    />
                    <div
                        className="absolute size-64 rounded-full blur-3xl opacity-[0.06] bottom-4 right-8 animate-pulse"
                        style={{
                            background: 'var(--color-accent-lavender)',
                            animationDuration: '10s',
                            animationDelay: '3s',
                        }}
                    />
                </div>

                <Stack
                    align="center"
                    gap={6}
                    className="relative rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] p-10 text-center"
                >
                    {/* Logo & Title */}
                    <Stack align="center" gap={4}>
                        <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-[var(--color-accent-orange)]/20 blur-2xl scale-[2]" />
                            <SourdawLogo className="relative h-20 drop-shadow-[0_6px_24px_rgba(217,119,6,0.45)]" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight text-white/90">
                                Welcome to the{' '}
                                <span className="bg-gradient-to-r from-[var(--color-accent-orange)] via-amber-300 to-[var(--color-accent-peach)] bg-clip-text text-transparent">
                                    Test Kitchen
                                </span>
                            </h2>
                            <p className="mt-1 text-[11px] font-semibold text-[var(--color-accent-peach)] uppercase tracking-widest">
                                Alpha Version 0.1.0
                            </p>
                        </div>
                    </Stack>

                    {/* Body Text */}
                    <p className="text-sm text-white/60 leading-relaxed max-w-[340px]">
                        This app is in early alpha. This might be overproofed, and features will change. If you
                        encounter any health code violations (bugs) or have suggestions, please use the{' '}
                        <strong className="text-white/85">Talk to us</strong> button in the bottom right corner to join
                        our Discord Bakery.
                    </p>

                    {/* Actions */}
                    <Row align="stretch" gap={3} className="w-full mt-2">
                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            className="group flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-[var(--color-accent-orange)]/25 bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)] transition-all duration-200 cursor-pointer hover:bg-[var(--color-accent-orange)]/20 hover:border-[var(--color-accent-orange)]/40 hover:shadow-[0_0_16px_rgba(217,119,6,0.2)]"
                            onClick={() => window.open('https://discord.gg/bJHmmfY4', '_blank')}
                        >
                            <DiscordIcon className="size-4" />
                            <span className="text-xs font-semibold">Join the Bakery</span>
                        </Button>

                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            className="flex-1 flex items-center justify-center p-3 rounded-xl border border-white/[0.07] bg-white/[0.05] text-white/70 transition-all duration-200 cursor-pointer hover:bg-white/[0.1] hover:text-white"
                            onClick={() => {
                                onOpenChange(false);
                            }}
                        >
                            <span className="text-xs font-semibold">Let me cook</span>
                        </Button>
                    </Row>
                </Stack>
            </DialogContent>
        </Dialog>
    );
};
