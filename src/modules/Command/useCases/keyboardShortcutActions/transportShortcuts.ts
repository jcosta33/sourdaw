/**
 * Transport keyboard shortcut delegates.
 * Thin wrappers satisfying module boundary rules.
 */
import { inject } from '#/infra/di/inject';
import { togglePlayback as togglePlaybackImpl } from '#/modules/Transport/useCases/transportControls/togglePlayback';
import { stopPlayback as stopPlaybackImpl } from '#/modules/Transport/useCases/transportControls/stopPlayback';
import { toggleLoop as toggleLoopImpl } from '#/modules/Transport/useCases/transportControls/toggleLoop';
import { toggleMetronome as toggleMetronomeImpl } from '#/modules/Transport/useCases/transportControls/toggleMetronome';
import { toggleRecording as toggleRecordingImpl } from '#/modules/Transport/useCases/transportControls/toggleRecording';
import { seekPlayhead as seekPlayheadImpl } from '#/modules/Transport/useCases/transportControls/seekPlayhead';

export const transportShortcutsDependencies = {
    togglePlayback: togglePlaybackImpl,
    stopPlayback: stopPlaybackImpl,
    toggleLoop: toggleLoopImpl,
    toggleMetronome: toggleMetronomeImpl,
    toggleRecording: toggleRecordingImpl,
    seekPlayhead: seekPlayheadImpl,
} as const;

export const togglePlayback = inject(transportShortcutsDependencies)((d) => () => d.togglePlayback());
export const stopPlayback = inject(transportShortcutsDependencies)((d) => () => d.stopPlayback());
export const toggleLoop = inject(transportShortcutsDependencies)((d) => () => d.toggleLoop());
export const toggleMetronome = inject(transportShortcutsDependencies)((d) => () => d.toggleMetronome());
export const toggleRecording = inject(transportShortcutsDependencies)((d) => () => d.toggleRecording());
export const seekPlayhead = inject(transportShortcutsDependencies)((d) => (beat: number) => d.seekPlayhead(beat));
