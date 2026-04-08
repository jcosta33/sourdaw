import { inject } from '#/infra/di/inject';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { updateTrack } from '../repositories/track/updateTrack';
import { createTrack } from '../models/Track';

export const createFolder = inject({ getTrackState, setTrackState })(
    ({ getTrackState, setTrackState }) =>
        function createFolder(name: string): void {
            const state = getTrackState();
            if (!state) {
                return;
            }

            const folder = createTrack({ name, kind: 'folder' });
            setTrackState({
                ...state,
                tracks: [...state.tracks, folder],
            });
        }
);

export const toggleFolderCollapse = inject({ updateTrack })(
    ({ updateTrack }) =>
        function toggleFolderCollapse(folderId: string): void {
            updateTrack(folderId, (t) => ({ ...t, collapsed: !t.collapsed }));
        }
);
