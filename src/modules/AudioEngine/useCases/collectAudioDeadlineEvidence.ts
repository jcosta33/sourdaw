import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { dropoutCounters } from '../engine/dropoutCounter';
import { LONG_TASK_OBSERVATION_UNSUPPORTED, readMainThreadLongTasks } from '../services/mainThreadLongTaskLatch';
import { engineRtDiagnosticsStore } from '../stores/engineRtDiagnosticsStore';

import { getEngineState } from './engineAccess/getEngineState';

import type {
    AudioDeadlineEvidence,
    AudioDeadlineWorkload,
    DeadlineCategoryReading,
} from '../models/AudioDeadlineEvidence';

/**
 * No external loopback signal is captured anywhere in the product. The desktop
 * latency harness takes every figure from the app's own readouts and never
 * recaptures the output it played (`scripts/measureDesktopLatency.ts`), so
 * nothing is positioned to notice a discontinuity in what a device actually
 * emitted. Reporting zero here would claim a clean external measurement that
 * was never taken.
 */
const LOOPBACK_UNCOVERED: DeadlineCategoryReading = {
    coverage: 'unavailable',
    reason: 'no external loopback signal is captured, so this platform has no discontinuity coverage rather than zero discontinuities',
};

/**
 * The counter itself decides both coverage and count. Whether the context is
 * running says nothing about whether anything is tallying: with no shared
 * buffer wired the counter answers zero from memory no worklet writes to, and a
 * suspended context does not undo an underrun already counted.
 */
function readEngineUnderruns(): DeadlineCategoryReading {
    if (!dropoutCounters.hasCoverage()) {
        return {
            coverage: 'unavailable',
            reason: 'no dropout-counting processor is wired, either because the project hosts no device that counts them or because the page is not cross-origin isolated and there is no shared buffer to count into',
        };
    }

    return { coverage: 'observed', events: dropoutCounters.read().detectedUnderrunBlocks };
}

function readNativeStreamFaults(): DeadlineCategoryReading {
    const diagnostics = engineRtDiagnosticsStore.value;

    if (diagnostics?.latest?.running !== true) {
        return {
            coverage: 'unavailable',
            reason: 'the native engine is not running, so no stream report is being collected from it',
        };
    }

    const faults = diagnostics.events.filter((event) => event.type === 'streamError');

    return { coverage: 'observed', events: faults.length };
}

function readMainThreadLongTaskCoverage(): DeadlineCategoryReading {
    const reading = readMainThreadLongTasks();

    if (reading === LONG_TASK_OBSERVATION_UNSUPPORTED) {
        return {
            coverage: 'unavailable',
            reason: 'this runtime does not support the longtask performance entry type',
        };
    }

    return { coverage: 'observed', events: reading };
}

/** The web carrier's own context rate, which is what `engineUnderruns` counted quanta at. */
function readWebEngine(): AudioDeadlineWorkload['webEngine'] {
    const engine = getEngineState();

    if (engine.state !== 'running') {
        return null;
    }

    return { sampleRate: engine.sampleRate };
}

/**
 * The rate the native output stream actually opened at and the frames its most
 * recent callback asked for — both figures `nativeStreamFaults` was counted
 * against, and neither one describing the web carrier beside it.
 */
function readNativeEngine(): AudioDeadlineWorkload['nativeEngine'] {
    const diagnostics = engineRtDiagnosticsStore.value?.latest;

    if (diagnostics?.running !== true) {
        return null;
    }

    return { sampleRate: diagnostics.sampleRate, outputBufferFrames: diagnostics.outputBufferFrames };
}

function readTransport(): AudioDeadlineWorkload['transport'] {
    const transport = transportStore.value ?? defaultTransportState;

    if (transport.isRecording) {
        return 'recording';
    }

    if (transport.isPlaying) {
        return 'playing';
    }

    return 'stopped';
}

/**
 * Take one deadline-evidence reading across every observer the platform has.
 *
 * Reads only: each source is asked for what it already holds, and no store is
 * written. A category whose observer this platform does not have comes back
 * `unavailable` with the reason, never as a count of zero.
 *
 * The workload entries pair each count with the carrier that produced it:
 * `engineUnderruns` belongs to `webEngine`, `nativeStreamFaults` belongs to
 * `nativeEngine`.
 */
export function collectAudioDeadlineEvidence(): AudioDeadlineEvidence {
    return {
        version: 1,
        workload: {
            webEngine: readWebEngine(),
            nativeEngine: readNativeEngine(),
            trackCount: trackStore.value?.tracks.length ?? 0,
            transport: readTransport(),
        },
        engineUnderruns: readEngineUnderruns(),
        nativeStreamFaults: readNativeStreamFaults(),
        mainThreadLongTasks: readMainThreadLongTaskCoverage(),
        loopbackDiscontinuities: LOOPBACK_UNCOVERED,
    };
}
