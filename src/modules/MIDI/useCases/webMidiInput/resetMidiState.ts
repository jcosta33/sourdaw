import { audioEngine } from '#/modules/AudioEngine/useCases';

import { resetMidiState as resetWebMidiState } from '../../repositories/webMidi/lifecycle/resetMidiState';

import { releaseNativeLiveNote } from './releaseNativeLiveNote';

export function resetMidiState(): void {
    resetWebMidiState({
        getCurrentTime: () => audioEngine.context.currentTime,
        getTrackStrip: (trackId) => audioEngine.getTrackStrip(trackId),
        releaseNativeNote: releaseNativeLiveNote,
    });
}
