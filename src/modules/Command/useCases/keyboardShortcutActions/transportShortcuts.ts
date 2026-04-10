/**
 * Transport keyboard shortcut delegates.
 * Thin wrappers satisfying module boundary rules.
 */
import {
    togglePlayback as _togglePlayback,
    stopPlayback as _stopPlayback,
    toggleLoop as _toggleLoop,
    toggleMetronome as _toggleMetronome,
    toggleRecording as _toggleRecording,
    seekPlayhead as _seekPlayhead,
} from '#/modules/Transport';

export const togglePlayback = (): void => _togglePlayback();
export const stopPlayback = (): void => _stopPlayback();
export const toggleLoop = (): void => _toggleLoop();
export const toggleMetronome = (): void => _toggleMetronome();
export const toggleRecording = (): void => _toggleRecording();
export const seekPlayhead = (beat: number): void => _seekPlayhead(beat);
