import { audioEngine } from '#/modules/AudioEngine/useCases';

import { destroyWebMidi as teardownWebMidi } from '../../repositories/webMidi/lifecycle/destroyWebMidi';

import { releaseNativeLiveNote } from './releaseNativeLiveNote';

/**
 * Tear the live MIDI input down, with the strip access and the native-note
 * release this module owns injected into the repository teardown. The shell's
 * quit path calls this so release events route while the audio and Yeast
 * runtimes are still alive.
 */
export function destroyWebMidi(): void {
    teardownWebMidi({
        getTrackStrip: (trackId) => audioEngine.getTrackStrip(trackId),
        releaseNativeNote: releaseNativeLiveNote,
    });
}
