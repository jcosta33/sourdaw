import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type Track } from '../models/Track';

const logger = Container.getInstance().get(Logger);

export type TrackStoreState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

export const trackStore = new Store<TrackStoreState>(logger, {
    initialData: {
        tracks: [],
        selectedTrackId: null,
    },
});
