import { type Track } from '../stores/trackStore';

import { addTrack } from './addTrack';
import { getTrackById } from './getTrackById';
import { publishTrackAdded } from './publishTrackAdded';

type AddTrackWithDeferredAddedEventInput = {
    name: string;
    kind: Track['kind'];
    select?: boolean;
};

type AddTrackWithDeferredAddedEventOutput = {
    track: Track;
    afterCommit: () => Promise<void>;
    afterAmbiguousCommit: () => Promise<void>;
};

export function addTrackWithDeferredAddedEvent(
    input: AddTrackWithDeferredAddedEventInput
): AddTrackWithDeferredAddedEventOutput | null {
    const track = addTrack({ ...input, suppressAddedEvent: true });
    if (!track) {
        return null;
    }
    const committedTrack = track;

    function publish(): Promise<void> {
        return publishTrackAdded({
            trackId: committedTrack.id,
            name: committedTrack.name,
            kind: committedTrack.kind,
        });
    }

    return {
        track: committedTrack,
        afterCommit: publish,
        afterAmbiguousCommit: async () => {
            const durableTrack = getTrackById(committedTrack.id);
            if (durableTrack?.name === committedTrack.name && durableTrack.kind === committedTrack.kind) {
                await publish();
            }
        },
    };
}
