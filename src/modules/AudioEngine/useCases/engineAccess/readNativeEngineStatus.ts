import { type EngineRtDiagnostics } from '../../models/EngineRtDiagnostics';
import { engineRtDiagnosticsStore } from '../../stores/engineRtDiagnosticsStore';
import { nativeLiveGraphSession } from '../livePlayback/nativeLiveGraphSessionState';

export type NativeEngineStatus = {
    /**
     * The native session's engine is the one a musician is actually hearing.
     * While this is true, Web Audio's own context state, rate, and latency
     * describe a path nobody is on and must not stand in for native readouts.
     */
    audibleCarrier: boolean;
    /**
     * The latest drained native diagnostics, or `null` before the first poll
     * has landed. No reading is not the same as a stopped engine: a stopped
     * engine reports the `running: false` shape, while `null` means nothing
     * has been read yet.
     */
    diagnostics: EngineRtDiagnostics | null;
};

/**
 * Read the native engine's status for provenance-aware readouts.
 *
 * The status bar needs to know which engine the listener hears before it can
 * label a rate, a latency, or a health dot. This is the one read that answers
 * that: the carrier decision from the live session state, beside the latest
 * diagnostics the once-per-second poll has published. Both are plain reads of
 * module state — no IPC, safe at animation-frame rate.
 */
export function readNativeEngineStatus(): NativeEngineStatus {
    return {
        audibleCarrier: nativeLiveGraphSession.audibleCarrier,
        diagnostics: engineRtDiagnosticsStore.value?.latest ?? null,
    };
}
