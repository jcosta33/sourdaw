import { createEventBus } from '#/infra/events/createEventBus';
import { logger } from '#/infra/logger/appLogger';

import { type TrackAddedPayload } from '#/modules/Arrangement/events/TrackAddedEvent';
import { type TrackRemovedPayload } from '#/modules/Arrangement/events/TrackRemovedEvent';
import { type AudioDeviceLoadedPayload } from '#/modules/AudioEngine/events/AudioDeviceLoadedEvent';

export type AppEvents = {
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'audioDevice.loaded': AudioDeviceLoadedPayload;
};

export const eventBus = createEventBus<AppEvents>();

export { logger };
