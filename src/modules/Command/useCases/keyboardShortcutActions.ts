/**
 * Keyboard Shortcut Actions — use case wrappers for cross-module
 * calls used by the keyboard shortcut presentation hook.
 *
 * The presentations layer cannot import use cases from other modules
 * directly. This module-local use case delegates to each cross-module
 * use case so the hook only imports from within Command.
 */

// ── Transport ─────────────────────────────────────────────────────
import {
    togglePlayback as _togglePlayback,
    stopPlayback as _stopPlayback,
    toggleLoop as _toggleLoop,
    toggleMetronome as _toggleMetronome,
    toggleRecording as _toggleRecording,
    seekPlayhead as _seekPlayhead,
} from '#/modules/Transport/useCases/transportControls';

export const togglePlayback = (): void => _togglePlayback();
export const stopPlayback = (): void => _stopPlayback();
export const toggleLoop = (): void => _toggleLoop();
export const toggleMetronome = (): void => _toggleMetronome();
export const toggleRecording = (): void => _toggleRecording();
export const seekPlayhead = (beat: number): void => _seekPlayhead(beat);

// ── Track ─────────────────────────────────────────────────────────
import { clearSolos as _clearSolos } from '#/modules/Track/useCases/toggleTrackState';
import { addTrack as _addTrack } from '#/modules/Track/useCases/addTrack';
import { duplicateTrack as _duplicateTrack } from '#/modules/Track/useCases/duplicateTrack';
import {
    duplicateClip as _duplicateClip,
    duplicateClipToNextBar as _duplicateClipToNextBar,
} from '#/modules/Clip/useCases/clipUseCases';
import { zoomTracksVertical as _zoomTracksVertical } from '#/modules/Track/useCases/trackZoom';

export const clearSolos = (): void => _clearSolos();
export const addTrack = (opts: Parameters<typeof _addTrack>[0]): void => {
    _addTrack(opts);
};
export const duplicateTrack = (trackId: string): void => _duplicateTrack(trackId);
export const duplicateClip = (clipId: string): void => _duplicateClip(clipId);
export const duplicateClipToNextBar = (clipId: string): void => _duplicateClipToNextBar(clipId);
export const zoomTracksVertical = (delta: number): void => _zoomTracksVertical(delta);

// ── Workspace ─────────────────────────────────────────────────────
import { setEditingTool as _setEditingTool } from '#/modules/Workspace/useCases/setEditingTool';
import { zoomToFit as _zoomToFit, zoomToSelection as _zoomToSelection } from '#/modules/Workspace/useCases/togglePanel';
import { type EditingTool } from '#/modules/Workspace/models/EditingTool';

export const setEditingTool = (tool: EditingTool): void => _setEditingTool(tool);
export const zoomToFit = (): void => _zoomToFit();
export const zoomToSelection = (): void => _zoomToSelection();
