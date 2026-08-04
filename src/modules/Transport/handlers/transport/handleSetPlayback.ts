import { createHandler } from '#/utils/createHandler';

import { transportStore } from '../../stores/transportStore';
import { setPlayback } from '../../useCases/transportControls/setPlayback';

export const handleSetPlayback = createHandler<'setPlayback'>({
    execute: (action) => {
        setPlayback(action.payload.playing);
    },
    describe: (action) => ({ label: action.payload.playing ? 'Start playback' : 'Pause playback' }),
    executionKind: 'runtime',
    isNoop: (action) => transportStore.value?.isPlaying === action.payload.playing,
    undoable: false,
});
