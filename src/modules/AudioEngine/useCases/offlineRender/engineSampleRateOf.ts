import { isExistingEngineReading } from '../../models/EngineRtDiagnostics';
import { type EngineRtDiagnosticsState } from '../../stores/engineRtDiagnosticsStore';

/**
 * The rate the running engine renders at, which is the rate a hosted instance
 * was activated at, or `null` when no engine runs. Takes the diagnostics a
 * caller read or subscribed to, for the same reason the tails come in as a
 * snapshot.
 */
export function engineSampleRateOf(diagnostics: EngineRtDiagnosticsState | null): number | null {
    const latest = diagnostics?.latest ?? null;
    return isExistingEngineReading(latest) ? latest.sampleRate : null;
}
