import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type ArrangementData } from '../models/ProjectData';

export type ArrangementStoreState = {
    arrangements: ArrangementData[];
    activeArrangementId: string;
};

export const defaultArrangementId = 'default-arrangement';

const logger = Container.getInstance().get(Logger);

export const arrangementStore = new Store<ArrangementStoreState>(logger, {
    initialData: {
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
        activeArrangementId: defaultArrangementId,
    },
});
