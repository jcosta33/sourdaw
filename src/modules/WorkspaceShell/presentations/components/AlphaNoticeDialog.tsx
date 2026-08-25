import { type ReactElement } from 'react';

import { Bug, MessageCircle } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent } from '#/components/ui/dialog';

import { PROJECT_LINKS } from '../projectLinks';

import { SourdawLogo } from './SourdawLogo';

export type AlphaNoticeDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

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
                        This app is in early alpha. This might be overproofed, and features will change. If you have
                        questions or feedback, start a GitHub Discussion. Please report bugs in GitHub Issues.
                    </p>

                    {/* Actions */}
                    <Stack gap={3} className="w-full mt-2">
                        <Row align="stretch" gap={3}>
                            <Button
                                asChild
                                variant="bare"
                                size="bare"
                                className="group flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-[var(--color-accent-orange)]/25 bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)] transition-all duration-200 cursor-pointer hover:bg-[var(--color-accent-orange)]/20 hover:border-[var(--color-accent-orange)]/40 hover:shadow-[0_0_16px_rgba(217,119,6,0.2)]"
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
                                className="group flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-white/[0.07] bg-white/[0.05] text-white/70 transition-all duration-200 cursor-pointer hover:bg-white/[0.1] hover:text-white"
                            >
                                <a href={PROJECT_LINKS.issues} target="_blank" rel="noopener noreferrer">
                                    <Bug className="size-4" aria-hidden="true" />
                                    <span className="text-xs font-semibold">Report a bug</span>
                                </a>
                            </Button>
                        </Row>
                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            className="flex items-center justify-center p-3 rounded-xl border border-white/[0.07] bg-white/[0.05] text-white/70 transition-all duration-200 cursor-pointer hover:bg-white/[0.1] hover:text-white"
                            onClick={() => {
                                onOpenChange(false);
                            }}
                        >
                            <span className="text-xs font-semibold">Let me cook</span>
                        </Button>
                    </Stack>
                </Stack>
            </DialogContent>
        </Dialog>
    );
};
