import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { type ProjectSummary } from '../../models/DsoLogicalState';
import { dsoEditorState } from '../../stores/dsoEditorState';

type BuildProjectSummaryOutput = ProjectSummary;

export function buildProjectSummary(): BuildProjectSummaryOutput {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const selectionState = clipSelectionStore.value;
    const editorState = dsoEditorState.value;

    return {
        project_revision: editorState?.revision ?? 0,
        track_count: trackState?.tracks.length ?? 0,
        selected_tracks: trackState?.selectedTrackId ? [trackState.selectedTrackId] : [],
        selected_clips: [...(selectionState?.selectedClipIds ?? [])],
        tempo: transportState?.tempo ?? 120,
        routing_summary: buildRoutingSummary(),
        recent_edits: [...(editorState?.recent_edits ?? [])],
    };
}

function buildRoutingSummary(): string {
    const trackState = trackStore.value;
    if (!trackState || trackState.tracks.length === 0) {
        return 'Empty project';
    }
    const names = trackState.tracks.slice(0, 8).map((track) => track.name);
    if (trackState.tracks.length > 8) {
        return `${names.join(', ')} +${trackState.tracks.length - 8} more → Master`;
    }
    return `${names.join(', ')} → Master`;
}
