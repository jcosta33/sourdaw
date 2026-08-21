import { type ReactElement, useEffect, useState } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { defaultOnboardingState, onboardingStore } from '../../stores/onboardingStore';
import { advanceOnboardingStep } from '../../useCases/advanceOnboardingStep';
import { dismissOnboardingTour } from '../../useCases/dismissOnboardingTour';
import { regressOnboardingStep } from '../../useCases/regressOnboardingStep';

type OnboardingAnchor =
    | 'transport-play'
    | 'track-list'
    | 'inspector'
    | 'mixer-button'
    | 'loop-station-tab'
    | 'setlist-tab'
    | 'modulation-tab'
    | 'adjustment-layer-strip'
    | 'track-ai-section'
    | null;

type OnboardingStep = {
    anchor: OnboardingAnchor;
    title: string;
    description: string;
};

const TOUR_STEPS: OnboardingStep[] = [
    {
        anchor: 'transport-play',
        title: 'Transport',
        description:
            "This is the transport. Press space to play/pause. Your projects come pre-wired, so hit play immediately to hear what you've got.",
    },
    {
        anchor: 'track-list',
        title: 'Track list',
        description:
            'Tracks live here. Add more via the + button, or drag audio/MIDI files directly onto the timeline.',
    },
    {
        anchor: 'inspector',
        title: 'Inspector',
        description:
            'Click any track to open the inspector. Tweak gain, pan, sends, devices, and automation modes from here.',
    },
    {
        anchor: 'mixer-button',
        title: 'Mixer',
        description:
            'The mixer shows every track strip with faders, meters, and sends. Use VCA groups to control related tracks together.',
    },
    {
        anchor: 'adjustment-layer-strip',
        title: 'Adjustment Layers',
        description:
            'Non-destructive effect regions that span multiple tracks. Drop an EQ, compressor, or reverb that affects everything below it — perfect for bus-style processing without rewiring routing.',
    },
    {
        anchor: 'loop-station-tab',
        title: 'Loop Station',
        description:
            'Ableton-style clip slots — record loops into slots and fire them live with the QWERTY grid. Great for building up ideas without committing to a timeline position.',
    },
    {
        anchor: 'setlist-tab',
        title: 'Setlist',
        description:
            'Performance cue list — drag to reorder, auto-advance for live sets. Build a sequence of sections, intros, and songs you can trigger seamlessly on stage.',
    },
    {
        anchor: 'modulation-tab',
        title: 'Modulation Matrix',
        description:
            'Add LFOs, envelopes, and step modulators then route them to any device parameter. Assign once, automate forever — modulation travels with the source.',
    },
    {
        anchor: 'track-ai-section',
        title: 'AI Generation',
        description:
            'Select a MIDI track to expose AI drum, melody, chord, and bassline generation right in the inspector. Great for breaking writer’s block or laying down a starting point.',
    },
    {
        anchor: null,
        title: 'Command palette',
        description:
            'Press ⌘K (or Ctrl+K on Windows) anywhere to search commands and jump to any action. Press ? for all keyboard shortcuts.',
    },
];

const TOOLTIP_WIDTH = 320;
const TOOLTIP_GAP = 16;
const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;

type Rect = {
    top: number;
    left: number;
    width: number;
    height: number;
};

const getAnchorRect = (anchor: OnboardingAnchor): Rect | null => {
    if (anchor === null) {
        return null;
    }
    if (typeof document === 'undefined') {
        return null;
    }
    const element = document.querySelector<HTMLElement>(`[data-onboarding="${anchor}"]`);
    if (!element) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
    };
};

const clampTooltipPosition = (
    rect: Rect | null,
    viewportWidth: number,
    viewportHeight: number
): { top: number; left: number } => {
    if (rect === null) {
        const centerLeft = Math.max(16, (viewportWidth - TOOLTIP_WIDTH) / 2);
        const centerTop = Math.max(16, viewportHeight / 2 - 100);
        return { top: centerTop, left: centerLeft };
    }
    const spaceBelow = viewportHeight - (rect.top + rect.height);
    const anchorTop = spaceBelow > 220 ? rect.top + rect.height + TOOLTIP_GAP : rect.top - 220 - TOOLTIP_GAP;
    const anchorLeft = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    const maxLeft = viewportWidth - TOOLTIP_WIDTH - 16;
    const clampedLeft = Math.max(16, Math.min(anchorLeft, maxLeft));
    const clampedTop = Math.max(16, Math.min(anchorTop, viewportHeight - 220));
    return { top: clampedTop, left: clampedLeft };
};

export const OnboardingTour = (): ReactElement | null => {
    const state = useStore(onboardingStore, defaultOnboardingState);
    const [viewport, setViewport] = useState<{ width: number; height: number }>(() => ({
        width: typeof window === 'undefined' ? 0 : window.innerWidth,
        height: typeof window === 'undefined' ? 0 : window.innerHeight,
    }));
    const [anchorRect, setAnchorRect] = useState<Rect | null>(null);

    const stepIndex = Math.max(0, Math.min(state.stepIndex, TOUR_STEPS.length - 1));
    const step = TOUR_STEPS[stepIndex]!;
    const isLastStep = stepIndex >= TOUR_STEPS.length - 1;

    useEffect(() => {
        if (!state.active) {
            return undefined;
        }

        const measure = (): void => {
            setViewport({ width: window.innerWidth, height: window.innerHeight });
            setAnchorRect(getAnchorRect(step.anchor));
        };

        measure();
        const frameId = window.requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [state.active, step.anchor]);

    useEffect(() => {
        if (!state.active) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                dismissOnboardingTour();
                return;
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                advanceOnboardingStep({ totalSteps: TOUR_STEPS.length });
                return;
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                regressOnboardingStep();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [state.active]);

    if (!state.active) {
        return null;
    }

    const spotlight = anchorRect;
    const tooltipPosition = clampTooltipPosition(spotlight, viewport.width, viewport.height);
    const nextLabel = isLastStep ? 'Finish' : 'Next';

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Onboarding tour"
            className="fixed inset-0 z-[10000]"
            style={{ pointerEvents: 'auto' }}
        >
            {spotlight ? (
                <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    width={viewport.width}
                    height={viewport.height}
                    aria-hidden="true"
                >
                    <defs>
                        <mask id="onboarding-spotlight-mask">
                            <rect x="0" y="0" width={viewport.width} height={viewport.height} fill="white" />
                            <rect
                                x={spotlight.left - SPOTLIGHT_PADDING}
                                y={spotlight.top - SPOTLIGHT_PADDING}
                                width={spotlight.width + SPOTLIGHT_PADDING * 2}
                                height={spotlight.height + SPOTLIGHT_PADDING * 2}
                                rx={SPOTLIGHT_RADIUS}
                                ry={SPOTLIGHT_RADIUS}
                                fill="black"
                            />
                        </mask>
                    </defs>
                    <rect
                        x="0"
                        y="0"
                        width={viewport.width}
                        height={viewport.height}
                        fill="rgba(0, 0, 0, 0.6)"
                        mask="url(#onboarding-spotlight-mask)"
                    />
                    <rect
                        x={spotlight.left - SPOTLIGHT_PADDING}
                        y={spotlight.top - SPOTLIGHT_PADDING}
                        width={spotlight.width + SPOTLIGHT_PADDING * 2}
                        height={spotlight.height + SPOTLIGHT_PADDING * 2}
                        rx={SPOTLIGHT_RADIUS}
                        ry={SPOTLIGHT_RADIUS}
                        fill="none"
                        stroke="var(--color-accent-orange)"
                        strokeWidth="2"
                    />
                </svg>
            ) : (
                <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
            )}

            <div
                className="absolute rounded-xl border border-white/10 bg-[hsl(220,14%,8%)] shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl"
                style={{
                    top: tooltipPosition.top,
                    left: tooltipPosition.left,
                    width: TOOLTIP_WIDTH,
                }}
            >
                <Row justify="between" className="px-4 py-3 border-b border-white/[0.06]">
                    <p className="text-[10px] uppercase tracking-wider text-white/40">
                        Step {stepIndex + 1} of {TOUR_STEPS.length}
                    </p>
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        onClick={dismissOnboardingTour}
                        className="text-[10px] text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                    >
                        Skip tour
                    </Button>
                </Row>
                <div className="px-4 py-3">
                    <h2 className="text-sm font-semibold text-white/90">{step.title}</h2>
                    <p aria-live="polite" className="mt-1.5 text-xs leading-relaxed text-white/70">
                        {step.description}
                    </p>
                </div>
                <Row gap={2} justify="between" className="px-4 py-3 border-t border-white/[0.06]">
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        onClick={regressOnboardingStep}
                        disabled={stepIndex === 0}
                        className="text-xs text-white/50 hover:text-white/90 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        Back
                    </Button>
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        onClick={() => {
                            if (isLastStep) {
                                dismissOnboardingTour();
                                return;
                            }
                            advanceOnboardingStep({ totalSteps: TOUR_STEPS.length });
                        }}
                        className="rounded-md bg-[var(--color-accent-orange)]/90 px-3 py-1.5 text-xs font-semibold text-black hover:bg-[var(--color-accent-orange)] transition-colors cursor-pointer"
                    >
                        {nextLabel}
                    </Button>
                </Row>
            </div>
        </div>
    );
};
