import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { workspaceStore } from '#/modules/Workspace/stores';

import { type ProjectSummary } from '../../models/DsoLogicalState';
import { getDsoEditorRecentEdits } from '../../stores/dsoEditorState';

import { getRevision } from './getRevision';

type BuildProjectSummaryOutput = ProjectSummary;

export function buildProjectSummary(): BuildProjectSummaryOutput {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;

    return {
        project_revision: getRevision(),
        track_count: trackState?.tracks.length ?? 0,
        selected_tracks: trackState?.selectedTrackId ? [trackState.selectedTrackId] : [],
        selected_clips: [...(workspaceState?.selectedClipIds ?? [])],
        tempo: transportState?.tempo ?? 120,
        routing_summary: buildRoutingSummary(),
        recent_edits: getDsoEditorRecentEdits(),
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
