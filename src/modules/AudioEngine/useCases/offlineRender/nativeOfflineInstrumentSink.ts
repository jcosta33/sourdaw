import { type Device, type Track } from '#/modules/Arrangement/stores';

import { nativeMidiNoteSink } from '../livePlayback/nativeMidiNoteSink';

import { classifyNativeOfflineHostedDevice, type NativeOfflineHostedRuntime } from './nativeOfflineHostedDevice';

/**
 * The loaded hosted instrument the native export plays this track's MIDI
 * through, or `null` when the track has none the native render prints.
 *
 * The sink is the live law's own (`nativeMidiNoteSink`: the first note sink in
 * chain order), read against the instances the render captured as loaded, so
 * the engine selection and the programme answer one question. A track whose
 * first sink is a built-in instrument, an effect plugin, a plugin the scan
 * holds no kind for, or a `yeast` strip answers `null`: those notes are voiced
 * web-side, and a native render of them would be a rest that reads as a correct
 * file.
 */
export function nativeOfflineInstrumentSink(track: Track, runtime: NativeOfflineHostedRuntime): Device | null {
    const sink = nativeMidiNoteSink({
        track,
        attachedInstanceIds: runtime.loadedInstanceIds,
        // A frozen strip never reaches here: the selection gates it first.
        bakedStripIds: new Set(),
    });
    if (sink.outcome !== 'voiced') {
        return null;
    }
    return classifyNativeOfflineHostedDevice(sink.device, runtime) === 'instrument' ? sink.device : null;
}
