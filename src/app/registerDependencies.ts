import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { ConsoleWriter } from '#/helpers/Logger/Writer/ConsoleWriter';
import { createEventBus } from '#/infra/events/createEventBus';

import { type TrackAddedPayload } from '#/modules/Arrangement/events/TrackAddedEvent';
import { type TrackRemovedPayload } from '#/modules/Arrangement/events/TrackRemovedEvent';
import { type AudioDeviceLoadedPayload } from '#/modules/AudioEngine/events/AudioDeviceLoadedEvent';

// This file must be imported before any module that resolves Logger
// at module scope. ES module imports are evaluated depth-first in source order,
// so importing './registerDependencies' before any other import in bootstrap.ts
// guarantees the container is populated before downstream modules load.

const logger = new Logger([new ConsoleWriter()]);
Container.getInstance().register(Logger, logger);

export type AppEvents = {
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'audioDevice.loaded': AudioDeviceLoadedPayload;
};

export const eventBus = createEventBus<AppEvents>();

export { logger };
