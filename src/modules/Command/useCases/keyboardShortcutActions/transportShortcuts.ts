/**
 * Transport keyboard shortcut delegates.
 * Thin wrappers satisfying module boundary rules.
 */
import { togglePlayback as _togglePlayback } from '#/modules/Transport/useCases/transportControls/togglePlayback';
import { stopPlayback as _stopPlayback } from '#/modules/Transport/useCases/transportControls/stopPlayback';
import { toggleLoop as _toggleLoop } from '#/modules/Transport/useCases/transportControls/toggleLoop';
import { toggleMetronome as _toggleMetronome } from '#/modules/Transport/useCases/transportControls/toggleMetronome';
import { toggleRecording as _toggleRecording } from '#/modules/Transport/useCases/transportControls/toggleRecording';
import { seekPlayhead as _seekPlayhead } from '#/modules/Transport/useCases/transportControls/seekPlayhead';

export const togglePlayback = (): void => _togglePlayback();
export const stopPlayback = (): void => _stopPlayback();
export const toggleLoop = (): void => _toggleLoop();
export const toggleMetronome = (): void => _toggleMetronome();
export const toggleRecording = (): void => _toggleRecording();
export const seekPlayhead = (beat: number): void => _seekPlayhead(beat);
