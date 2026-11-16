import { logger } from '#/infra/logger/appLogger';
import { runAllEffects } from '#/utils/runEffects';

import { type AudioPreviewIntent } from '../../models/AudioPreviewIntent';
import { createAudioPreviewIntents } from '../../services/audioPreview/createAudioPreviewIntents';

export type AudioPreviewTone = { stop: () => void; ready: Promise<void> };

export type AudioPreview = {
    beginOrdinaryIntent(): AudioPreviewIntent;
    beginExclusiveIntent(): AudioPreviewIntent;
    setProgrammeSuppressed(suppressed: boolean): void;
    holdRestoration(restoration: Promise<void>): void;
    playTone(frequency: number, durationSeconds: number, intent: AudioPreviewIntent): AudioPreviewTone | null;
    /** Opens one graph reset; resets nest, and only the outermost one's end opens a fresh intent lifetime. */
    beginReset(): void;
    /** The reset's first effect: every preview intent of the outgoing lifetime is invalidated. */
    disposeIntents(): void;
    endReset(): void;
};

export type AudioPreviewPorts = Readonly<{
    readContext: () => AudioContext;
    /** The edge whose connection to {@link readMonitorMono} carries programme to the listening output. */
    readProgrammeGate: () => GainNode;
    readMonitorMono: () => GainNode;
    isDisposed: () => boolean;
    isFallback: () => boolean;
}>;

type ToneNodes = { oscillator: OscillatorNode; gain: GainNode };

type ToneState = ToneNodes & {
    readContext: () => AudioContext;
    intent: AudioPreviewIntent;
    ended: boolean;
    started: boolean;
};

function assertToneInput(frequency: number, durationSeconds: number): void {
    if (!Number.isFinite(frequency) || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
        throw new RangeError('Preview tone frequency and duration must be finite.');
    }
}

function createToneNodes(context: AudioContext, intent: AudioPreviewIntent): ToneNodes {
    try {
        const oscillator = context.createOscillator();
        try {
            return { oscillator, gain: context.createGain() };
        } catch (error) {
            oscillator.disconnect();
            throw error;
        }
    } catch (error) {
        intent.release();
        throw error;
    }
}

function finishTone(tone: ToneState, stopSource: boolean, stop: () => void): void {
    if (tone.ended) {
        return;
    }
    tone.ended = true;
    tone.oscillator.onended = null;
    tone.intent.signal.removeEventListener('abort', stop);
    runAllEffects([
        () => tone.gain.gain.setValueAtTime(0, tone.readContext().currentTime),
        () => {
            if (stopSource && tone.started) {
                tone.oscillator.stop();
            }
        },
        () => tone.oscillator.disconnect(),
        () => tone.gain.disconnect(),
        () => tone.intent.release(),
    ]);
}

function wireTone(tone: ToneState, frequency: number, stop: () => void, finish: (stopSource: boolean) => void): void {
    try {
        tone.oscillator.type = 'sine';
        tone.oscillator.frequency.value = frequency;
        tone.oscillator.connect(tone.gain);
        tone.gain.connect(tone.readContext().destination);
        tone.oscillator.onended = () => finish(false);
        tone.intent.signal.addEventListener('abort', stop, { once: true });
    } catch (error) {
        finish(false);
        throw error;
    }
}

function startTone(tone: ToneState, durationSeconds: number): void {
    if (tone.ended || !tone.intent.isCurrent()) {
        return;
    }
    const now = tone.readContext().currentTime;
    tone.gain.gain.setValueAtTime(0.4, now);
    tone.gain.gain.exponentialRampToValueAtTime(0.001, now + durationSeconds);
    tone.started = true;
    tone.oscillator.start();
    tone.oscillator.stop(now + durationSeconds);
}

function playPreviewTone(
    readContext: () => AudioContext,
    frequency: number,
    durationSeconds: number,
    intent: AudioPreviewIntent
): AudioPreviewTone | null {
    assertToneInput(frequency, durationSeconds);
    if (!intent.isCurrent()) {
        return null;
    }
    const tone: ToneState = {
        ...createToneNodes(readContext(), intent),
        readContext,
        intent,
        ended: false,
        started: false,
    };
    function finish(stopSource: boolean): void {
        finishTone(tone, stopSource, stop);
    }
    function stop(): void {
        finish(true);
    }
    function start(): void {
        startTone(tone, durationSeconds);
    }
    wireTone(tone, frequency, stop, finish);
    try {
        if (intent.ready === undefined) {
            start();
        }
    } catch (error) {
        stop();
        throw error;
    }
    const ready = intent.ready === undefined ? Promise.resolve() : intent.ready.then(start);
    void ready.catch((error: unknown) => {
        stop();
        logger.warn(new Error('Preview tone could not restore its listening output', { cause: error }));
    });
    return { stop, ready };
}

export function createAudioPreview({
    readContext,
    readProgrammeGate,
    readMonitorMono,
    isDisposed,
    isFallback,
}: AudioPreviewPorts): AudioPreview {
    let intents = createAudioPreviewIntents();
    let resetDepth = 0;
    let programmeOpen = true;
    let restoration: Promise<void> | null = null;

    function beginOrdinaryIntent(): AudioPreviewIntent {
        const intent = intents.beginOrdinary();
        if (restoration === null) {
            return intent;
        }
        return { ...intent, ready: restoration };
    }

    function beginExclusiveIntent(): AudioPreviewIntent {
        // A suspended context must resume with programme already closed, in
        // the gesture itself, before any asynchronous native admission.
        setProgrammeSuppressed(true);
        return intents.beginExclusive();
    }

    function setProgrammeSuppressed(suppressed: boolean): void {
        if (isDisposed() || isFallback() || (!suppressed && intents.hasExclusive())) {
            return;
        }
        const open = !suppressed;
        if (programmeOpen === open) {
            return;
        }
        if (open) {
            readProgrammeGate().connect(readMonitorMono());
        } else {
            readProgrammeGate().disconnect(readMonitorMono());
        }
        programmeOpen = open;
    }

    /**
     * Ordinary previews wait only while a restoration is in flight. A rejected one is not
     * latched: its owner retries the restore, and the programme gate stays closed until then.
     */
    function holdRestoration(held: Promise<void>): void {
        restoration = held;
        function release(): void {
            if (restoration === held) {
                restoration = null;
            }
        }
        void held.then(release, release);
    }

    function endReset(): void {
        resetDepth--;
        // Nested teardown and its callbacks cannot reopen the outgoing preview lifetime.
        if (resetDepth === 0 && !isDisposed()) {
            intents = createAudioPreviewIntents();
        }
    }

    return {
        beginOrdinaryIntent,
        beginExclusiveIntent,
        setProgrammeSuppressed,
        holdRestoration,
        playTone: (frequency, durationSeconds, intent) =>
            playPreviewTone(readContext, frequency, durationSeconds, intent),
        beginReset: () => {
            resetDepth++;
        },
        disposeIntents: () => intents.dispose(),
        endReset,
    };
}
