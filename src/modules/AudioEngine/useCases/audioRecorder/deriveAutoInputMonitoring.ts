type AutoMonitorInputs = {
    inputMonitoring: 'auto' | 'on' | 'off';
    armed: boolean;
    isPlaying: boolean;
    isRecording: boolean;
};

/** `unmanaged` marks modes the user's own gesture owns, which Auto never touches. */
type AutoMonitorEdge = 'open' | 'closed' | 'unmanaged';

/**
 * Tape-style Auto monitoring: an armed track is heard while the transport is
 * stopped or recording, and never during playback of recorded material or once
 * disarmed. On and Off are explicit user intent and stay out of this law.
 */
export function deriveAutoMonitorEdge(inputs: AutoMonitorInputs): AutoMonitorEdge {
    if (inputs.inputMonitoring !== 'auto') {
        return 'unmanaged';
    }
    if (!inputs.armed) {
        return 'closed';
    }
    return !inputs.isPlaying || inputs.isRecording ? 'open' : 'closed';
}
