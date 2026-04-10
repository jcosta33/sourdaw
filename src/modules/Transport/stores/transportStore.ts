import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { defaultTransportState, type TransportState } from '../useCases/transportQueries';

const DOC_PREFIX_ROOT = 'root';

export const transportStore = createStore<TransportState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'transport', {
        toCrdt: ({
            tempo,
            timeSignatureNumerator,
            timeSignatureDenominator,
            isLooping,
            loopStart,
            loopEnd,
            metronomeEnabled,
            metronomeVolume,
            punchInEnabled,
            punchInBeat,
            punchOutBeat,
            countInEnabled,
            countInBars,
            preRollEnabled,
            preRollBars,
            masterGain,
        }) => ({
            tempo,
            timeSignatureNumerator,
            timeSignatureDenominator,
            isLooping,
            loopStart,
            loopEnd,
            metronomeEnabled,
            metronomeVolume,
            punchInEnabled,
            punchInBeat,
            punchOutBeat,
            countInEnabled,
            countInBars,
            preRollEnabled,
            preRollBars,
            masterGain,
        }),
    }),
    initialData: defaultTransportState,
});
