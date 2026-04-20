import { addTrack } from '#/modules/Arrangement/useCases';

type TrackInfo = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'group' | 'folder' | 'bus' | 'master';
};

/** Create a new track for hosting a plugin. */
export function createTrackForPlugin(name: string, kind: 'audio' | 'midi'): TrackInfo | null {
    return addTrack({ name, kind });
}
