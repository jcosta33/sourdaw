/**
 * Elastic audio store — owns runtime state for elastic audio processing.
 */
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ElasticAudioState } from '#/modules/AudioEngine/models/ElasticAudioTypes';

export type { TransientMarker, ElasticAudioMode, ElasticAudioState } from '#/modules/AudioEngine/models/ElasticAudioTypes';

const logger = Container.getInstance().get(Logger);

export const elasticAudioStore = new Store<ElasticAudioState>(logger, {
    initialData: {
        transients: new Map(),
        quantizeStrength: 1,
        gridDivision: 4,
        mode: 'polyphonic',
        preserveFormants: true,
    },
});
