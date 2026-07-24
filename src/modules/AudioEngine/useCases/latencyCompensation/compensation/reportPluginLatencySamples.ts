import { getAudioContext } from '../../engineAccess/getAudioContext';

import { reportLatency } from './reportLatency';

type AudioContextSampleRateShape = {
    sampleRate?: number;
};

/**
 * Report a native plugin's latency (in samples, as CLAP's clap_plugin_latency.get
 * returns it) into the shared externalLatencyRegistry — the same registry the
 * WASM devices feed. The registry stores milliseconds, so this converts using the
 * live AudioContext sample rate exactly as the WASM path does
 * (wasmDeviceRegistry). Keyed by the engine device id so per-track PDC (RT-4) can
 * sum it alongside every other device on the chain.
 *
 * This lane reports latency only; consuming it into plugin-delay compensation is
 * a separate concern (RT-4).
 */
export function reportPluginLatencySamples(deviceId: string, latencySamples: number): void {
    const context: AudioContextSampleRateShape = getAudioContext();
    const sampleRate = context.sampleRate ?? 48000;
    reportLatency(deviceId, (latencySamples / sampleRate) * 1000);
}
