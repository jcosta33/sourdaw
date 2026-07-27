import { inject } from '#/infra/di/inject';

import { type TrackAddedPayload } from '../events/TrackAddedEvent';

import { ArrangementEventBus } from './arrangementEventBus';

export const publishTrackAdded = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function publishTrackAdded(payload: TrackAddedPayload): Promise<void> {
            return eventBus.emit('track.added', payload);
        }
);
