import { engineRtDiagnosticsStore } from '../../stores/engineRtDiagnosticsStore';
import { nativeLiveGraphSession } from '../livePlayback/nativeLiveGraphSessionState';

/**
 * The native output stream's device latency, in seconds, split the way the
 * status bar reports Web Audio's own reading: the context's own buffer
 * against the device's own added delay.
 */
export type NativeOutputLatency = Readonly<{
    contextSeconds: number;
    deviceSeconds: number;
}>;

/**
 * Read the native engine's output latency, or `null` when the native session
 * is not the audible carrier, when no reading has arrived yet, or when the
 * reading has nothing to compute a figure from.
 *
 * Gated on `nativeLiveGraphSession.audibleCarrier` for the same reason
 * `readNativeEngineMasterPeak` is: while Web Audio carries the monitor, the
 * native stream's own buffer and device latency describe a path nobody is
 * hearing, and showing them beside Web Audio's own reading would put two
 * unrelated numbers in one readout.
 *
 * `null` beyond that carries no distinction a caller needs to react to
 * differently: a stopped engine, a diagnostics poll that has not landed yet,
 * a running engine whose stream has not yet rendered a callback (so
 * `outputBufferFrames` still reads its start-up zero), and a backend that
 * publishes no output-path figure at all (WASAPI, today) are all "no native
 * figure to show," and every one of them falls back to Web Audio's own
 * `baseLatency + outputLatency` computation exactly as an engine that was
 * never the carrier does. A zero `outputPathFrames` is read the same way
 * rather than as a measured zero-latency path, because this build cannot
 * tell "the backend has nothing to say" from "the backend measured
 * nothing" — and showing a device term nobody measured would be worse than
 * falling back.
 */
export function readNativeOutputLatency(): NativeOutputLatency | null {
    if (!nativeLiveGraphSession.audibleCarrier) {
        return null;
    }
    const diagnostics = engineRtDiagnosticsStore.value?.latest;
    if (!diagnostics || !diagnostics.running) {
        return null;
    }
    const { sampleRate, outputBufferFrames, outputPathFrames } = diagnostics;
    if (sampleRate <= 0 || outputBufferFrames <= 0 || outputPathFrames <= 0) {
        return null;
    }
    // The backend's whole output path minus the context's own buffer is what
    // the device adds beyond it. Clamped at zero rather than left signed: a
    // path figure at or below the buffer is a backend fault, not a negative
    // device contribution the status bar could show.
    return {
        contextSeconds: outputBufferFrames / sampleRate,
        deviceSeconds: Math.max(outputPathFrames - outputBufferFrames, 0) / sampleRate,
    };
}
