/**
 * The Analyze handler's stall, asserted behaviourally and without a clock.
 *
 * `handleAnalyze` (`../ClipAudioAiSection.tsx:66-85`) is declared `(): void`. It
 * calls `setIsAnalyzing(true)`, then `summarizeFeatures` and
 * `detectDominantPitch` back to back with no `await` and no yield of any kind,
 * then `setIsAnalyzing(false)` in its `finally`. React 19 batches both state
 * updates into a single re-render, and that render sees `isAnalyzing === false`
 * — so the "Analyzing…" spinner the component renders at `:246-248` **can never
 * paint**, no matter how long the two analyses take.
 *
 * That is a claim about control flow, not about speed, and this is where it is
 * asserted. The two mocked analyses record what the DOM showed at the moment
 * they ran; the test then asserts the spinner was never observable while the
 * work was in flight, and that the results the handler computed did reach the
 * panel. No timer, no threshold, nothing that a busy machine can change.
 *
 * **The mutation that reds it:** make `handleAnalyze` `async` and put a single
 * `await Promise.resolve();` after `setIsAnalyzing(true)`. React then flushes
 * the pending render before the analyses run, `spinnerWhileAnalysing` becomes
 * `[true, true]`, and this case fails. That mutation is also the fix, which is
 * the point — this test reds when the defect is repaired and must be rewritten
 * then, rather than being kept green.
 *
 * **What this file deliberately does not do is time anything.** A wall-clock
 * assertion in the shared suite can only pass or fail, so machine load would be
 * misreported as a product regression. This case proves the control-flow defect
 * without depending on timing.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { detectDominantPitch, summarizeFeatures } from '#/modules/AudioAnalysis/useCases';

import { ClipAudioAiSection } from '../ClipAudioAiSection';

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, startSlot }: { title: string; startSlot?: React.ReactNode }) => (
        <div>
            {startSlot}
            <span>{title}</span>
        </div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        disabled,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        'aria-label'?: string;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, 'aria-label': ariaLabel }: { value: number[]; 'aria-label'?: string }) => (
        <input type="range" readOnly value={value[0]} aria-label={ariaLabel} />
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../components/Inspector/ControlHeader', () => ({
    ControlHeader: ({ label, value }: { label: string; value?: string }) => (
        <div>
            <span>{label}</span>
            {value === undefined ? null : <span>{value}</span>}
        </div>
    ),
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({ notifyAiChange: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ getCachedAudioBuffer: vi.fn(() => null) }));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    audioToMidi: vi.fn(),
    detectDominantPitch: vi.fn(),
    insertPolyphonicMidiNotes: vi.fn(),
    polyphonicAudioToMidi: vi.fn(),
    summarizeFeatures: vi.fn(),
}));

/** The label the component renders while it believes an analysis is running. */
const SPINNER_LABEL = /Analyzing…/;

const clip = {
    id: 'clip-1',
    type: 'audio' as const,
    name: 'Test Audio',
    trackId: 'track-1',
    startBeat: 0,
    endBeat: 8,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#ff0000',
    locked: false,
    muted: false,
    audioBufferId: 'buffer-1',
};

describe('ClipAudioAiSection Analyze handler — the spinner that cannot paint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('never makes the Analyzing state observable, and still routes both results to the panel', () => {
        // Each analysis reports what the DOM showed at the instant it ran —
        // i.e. part-way through the synchronous click handler, after
        // `setIsAnalyzing(true)` has been called.
        const spinnerWhileAnalysing: boolean[] = [];
        const observeSpinner = (): void => {
            spinnerWhileAnalysing.push(screen.queryByText(SPINNER_LABEL) !== null);
        };
        vi.mocked(summarizeFeatures).mockImplementation(() => {
            observeSpinner();
            return {
                avgRms: 0.25,
                peakRms: 0.61,
                avgSpectralCentroid: 1800,
                avgSpectralFlatness: 0.4,
                avgZcr: 0.11,
                chromaProfile: Array.from({ length: 12 }, () => 0.5),
                frameCount: 930,
            };
        });
        vi.mocked(detectDominantPitch).mockImplementation(() => {
            observeSpinner();
            return { noteName: 'C4', frequency: 261.6, clarity: 0.93, midiPitch: 60, timeSec: 0 };
        });

        render(<ClipAudioAiSection clip={clip} trackId="track-1" />);
        expect(screen.queryByText(SPINNER_LABEL)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));

        expect({
            // Both analyses ran inside one synchronous handler...
            analysesRun: spinnerWhileAnalysing.length,
            // ...and neither of them ever saw the spinner React was told to show.
            spinnerWhileAnalysing,
            // Still showing nothing afterwards, because the pair of updates
            // collapsed into one render that reads `false`.
            spinnerAfterClick: screen.queryByText(SPINNER_LABEL) !== null,
            // The work really happened and its readouts reached the panel, so
            // the absence above is "never painted", not "never ran".
            features: screen.queryByText(/RMS: 0\.250/)?.textContent ?? null,
            pitch: screen.queryByText(/Dominant: C4/)?.textContent ?? null,
        }).toEqual({
            analysesRun: 2,
            spinnerWhileAnalysing: [false, false],
            spinnerAfterClick: false,
            features: 'RMS: 0.250 | Brightness: 1800 Hz | Tonality: 0.60',
            pitch: 'Dominant: C4 (261.6 Hz, 93% clarity)',
        });
    });
});
