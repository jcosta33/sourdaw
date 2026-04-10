/**
 * Transport keyboard shortcut delegates.
 * Thin wrappers satisfying module boundary rules.
 */
import { inject } from '#/infra/di/inject';
import {
    seekPlayhead as seekPlayheadImpl,
    stopPlayback as stopPlaybackImpl,
    toggleLoop as toggleLoopImpl,
    toggleMetronome as toggleMetronomeImpl,
    togglePlayback as togglePlaybackImpl,
    toggleRecording as toggleRecordingImpl,
} from '#/modules/Transport';

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
