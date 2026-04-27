import { type ReactElement, useEffect, useState } from 'react';

import { Volume2 } from 'lucide-react';

import { getAudioContext, resumeEngine } from '#/modules/AudioEngine/useCases';

const DISMISSED_KEY = 'wd:audio-resume-dismissed';
const POLL_INTERVAL_MS = 250;

const readDismissedFlag = (): boolean => {
    try {
        return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
        return false;
    }
};

const needsResume = (state: AudioContextState): boolean => state === 'suspended' || state === 'interrupted';

export const AudioResumeOverlay = (): ReactElement | null => {
    const [dismissed, setDismissed] = useState<boolean>(readDismissedFlag);
    const [visible, setVisible] = useState<boolean>(() => {
        if (readDismissedFlag()) {
            return false;
        }
        return needsResume(getAudioContext().state);
    });

    useEffect(() => {
        if (dismissed) {
            setVisible(false);
            return;
        }

        const context = getAudioContext();

        const syncVisibility = (): void => {
            setVisible(needsResume(context.state));
        };

        syncVisibility();

        const supportsEvents = typeof context.addEventListener === 'function';
        if (supportsEvents) {
            context.addEventListener('statechange', syncVisibility);
        }

        const interval = setInterval(syncVisibility, POLL_INTERVAL_MS);

        return () => {
            clearInterval(interval);
            if (supportsEvents) {
                context.removeEventListener('statechange', syncVisibility);
            }
        };
    }, [dismissed]);

    useEffect(() => {
        if (!visible) {
            return;
        }

        const onGesture = (): void => {
            void resumeEngine();
        };

        window.addEventListener('click', onGesture);
        window.addEventListener('keydown', onGesture);
        window.addEventListener('pointerdown', onGesture);
        return () => {
            window.removeEventListener('click', onGesture);
            window.removeEventListener('keydown', onGesture);
            window.removeEventListener('pointerdown', onGesture);
        };
    }, [visible]);

    if (!visible) {
        return null;
    }

    const handleOverlayClick = (): void => {
        void resumeEngine();
    };

    const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        try {
            localStorage.setItem(DISMISSED_KEY, '1');
        } catch {}
        setDismissed(true);
        setVisible(false);
    };

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Audio paused — click to resume"
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
            onClick={handleOverlayClick}
        >
            <div
                className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl p-8 max-w-[380px] w-[90%] shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)]"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 20%, rgba(217,119,6,0.08) 0%, rgba(0,0,0,0) 70%), rgba(255,255,255,0.03)',
                }}
            >
                <div className="relative">
                    <div
                        className="absolute inset-0 rounded-full blur-2xl scale-[2] opacity-40"
                        style={{ background: 'var(--color-accent-orange)' }}
                    />
                    <div
                        className="relative flex size-14 items-center justify-center rounded-full"
                        style={{
                            background: 'color-mix(in srgb, var(--color-accent-orange) 18%, transparent)',
                            color: 'var(--color-accent-orange)',
                        }}
                    >
                        <Volume2 className="size-7" aria-hidden="true" />
                    </div>
                </div>
                <div className="text-center space-y-1.5">
                    <h2 className="text-base font-semibold text-white/90">Audio paused</h2>
                    <p className="text-xs text-white/55 leading-relaxed">
                        Web browsers require a click to start audio. Click anywhere to continue.
                    </p>
                </div>
                <button
                    type="button"
                    className="text-[10px] text-white/30 hover:text-white/55 underline-offset-2 hover:underline transition-colors cursor-pointer"
                    onClick={handleDismiss}
                >
                    Don&apos;t show again
                </button>
            </div>
        </div>
    );
};
