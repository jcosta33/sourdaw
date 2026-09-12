import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { dropoutCounters } from '../engine/dropoutCounter';
import { isExistingEngineReading } from '../models/EngineRtDiagnostics';
import { LONG_TASK_OBSERVATION_UNSUPPORTED, readMainThreadLongTasks } from '../services/mainThreadLongTaskLatch';
import { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from '../stores/engineRtDiagnosticsStore';

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

/**
 * Count the stream faults a native engine has reported this session.
 *
 * Coverage is the store's standing record of having read a native engine, not
 * the shape of its latest reading. The faults counted here describe a stream
 * that stopped, and an engine that has stopped rendering is retired with its
 * handle dropped, so the readings taken from then on carry the no-engine shape
 * while the fault that caused it still stands in the history. Deciding coverage
 * from the latest reading would report none at exactly the moment the count
 * holds the fault worth reporting.
 *
 * The count is cumulative for the session and can span engine generations: the
 * history survives one engine being retired and the next one opening, so a
 * fault counted here need not belong to the engine `workload.nativeEngine`
 * names.
 */
function readNativeStreamFaults(): DeadlineCategoryReading {
    const diagnostics = engineRtDiagnosticsStore.value ?? defaultEngineRtDiagnosticsState;

    if (!diagnostics.nativeEngineObserved) {
        return {
            coverage: 'unavailable',
            reason: 'no reading from a native engine has been recorded this session, so there are no native stream faults to count',
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
 * The rate the native output stream currently open actually opened at, and the
 * frames its most recent callback asked for — neither figure describing the web
 * carrier beside it.
 *
 * Names the native engine that exists now, and is null once none does. It
 * survives the stream ceasing to render, because the handle and its negotiated
 * rate outlive that, but not the engine being retired. It is therefore not a
 * carrier for `nativeStreamFaults`, whose count is cumulative for the session
 * and can hold faults an earlier engine reported at another rate.
 *
 * The frames slot is written only from inside the render callback, so it holds
 * zero on a stream that has opened but never rendered. That zero is a figure
 * nobody produced and is reported as absent.
 */
function readNativeEngine(): AudioDeadlineWorkload['nativeEngine'] {
    const latest = engineRtDiagnosticsStore.value?.latest ?? null;

    if (!isExistingEngineReading(latest)) {
        return null;
    }

    const { sampleRate, outputBufferFrames } = latest;

    return { sampleRate, outputBufferFrames: outputBufferFrames === 0 ? null : outputBufferFrames };
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
 * `engineUnderruns` belongs to the `webEngine` entry beside it: the counter is
 * fed by the worklets that context hosts, and closing it ends the coverage.
 * `nativeStreamFaults` has no such carrier. Its count is cumulative for the
 * session and can span native engine generations, so `nativeEngine` names the
 * native engine open now rather than the one each fault was counted against.
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
