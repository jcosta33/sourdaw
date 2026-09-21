import { type Track } from '#/modules/Arrangement/stores';
import { type sidechainStore } from '#/modules/Routing/stores';

export type LatencyCompensationInput = {
    tracks: readonly Pick<Track, 'id' | 'devices' | 'sends' | 'outputId'>[];
    routes: NonNullable<typeof sidechainStore.value>['routes'];
    deviceLatencyMs: ReadonlyMap<string, number>;
};
