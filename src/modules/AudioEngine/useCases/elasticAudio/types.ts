import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type TransientMarker = {
    id: string;
    /** Position in seconds (relative to clip start) */
    positionSec: number;
    /** Strength of the transient (0-1) */
    strength: number;
    /** Is this marker locked (won't move during quantize)? */
    locked: boolean;
};

export type ElasticAudioMode = 'polyphonic' | 'monophonic' | 'rhythmic' | 'x-form';

export type ElasticAudioState = {
    /** Detected transients per clip ID */
    transients: Map<string, TransientMarker[]>;
    /** Default quantize strength (0-1) */
    quantizeStrength: number;
    /** Grid subdivision for quantize */
    gridDivision: number;
    /** Processing mode */
    mode: ElasticAudioMode;
    /** Whether to preserve formants */
    preserveFormants: boolean;
};

export const elasticAudioStore = new Store<ElasticAudioState>(logger, {
    initialData: {
        transients: new Map(),
        quantizeStrength: 1,
        gridDivision: 4,
        mode: 'polyphonic',
        preserveFormants: true,
    },
});
