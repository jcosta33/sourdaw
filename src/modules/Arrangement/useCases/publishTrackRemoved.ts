import { inject } from '#/infra/di/inject';

import { type TrackRemovedPayload } from '../events/TrackRemovedEvent';

import { ArrangementEventBus } from './arrangementEventBus';

export const publishTrackRemoved = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function publishTrackRemoved(payload: TrackRemovedPayload): Promise<void> {
            return eventBus.emit('track.removed', payload);
        }
);
