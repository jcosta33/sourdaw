import { trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { LONG_TASK_OBSERVATION_UNSUPPORTED, readMainThreadLongTasks } from '../services/mainThreadLongTaskLatch';
import { engineRtDiagnosticsStore } from '../stores/engineRtDiagnosticsStore';

import { getEngineHealth } from './engineAccess/getEngineHealth';
import { getEngineState } from './engineAccess/getEngineState';

import type { AudioDeadlineEvidence, DeadlineCategoryReading } from '../models/AudioDeadlineEvidence';

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

function readEngineUnderruns(): DeadlineCategoryReading {
    if (getEngineState().state !== 'running') {
        return {
            coverage: 'unavailable',
            reason: 'no live web audio engine is running, so no render quantum has been observed',
        };
    }

    return { coverage: 'observed', events: getEngineHealth().dropouts.detectedUnderrunBlocks };
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

/**
 * The rate the reading was taken at. The native engine's figure is the rate its
 * output stream actually opened at, so it answers while that engine runs; the
 * web engine's own context rate answers otherwise.
 */
function readSampleRate(): number {
    const diagnostics = engineRtDiagnosticsStore.value?.latest;

    if (diagnostics?.running === true) {
        return diagnostics.sampleRate;
    }

    return getEngineState().sampleRate;
}

/**
 * Frames the native output device's most recent callback asked for; there is no
 * web-side equivalent to fall back to. Zero means no figure, not no buffer, the
 * same reading rule `EngineRtDiagnostics.outputBufferFrames` is read under.
 */
function readOutputBufferFrames(): number {
    return engineRtDiagnosticsStore.value?.latest?.outputBufferFrames ?? 0;
}

function readTransport(): AudioDeadlineEvidence['workload']['transport'] {
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
 */
export function collectAudioDeadlineEvidence(): AudioDeadlineEvidence {
    return {
        version: 1,
        workload: {
            sampleRate: readSampleRate(),
            outputBufferFrames: readOutputBufferFrames(),
            trackCount: trackStore.value?.tracks.length ?? 0,
            transport: readTransport(),
        },
        engineUnderruns: readEngineUnderruns(),
        nativeStreamFaults: readNativeStreamFaults(),
        mainThreadLongTasks: readMainThreadLongTaskCoverage(),
        loopbackDiscontinuities: LOOPBACK_UNCOVERED,
    };
}
