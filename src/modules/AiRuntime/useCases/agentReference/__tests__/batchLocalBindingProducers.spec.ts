import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { resolveBatchLocalBindingProducer } from '../batchLocalBindingProducers';

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('resolveBatchLocalBindingProducer', () => {
    it('declares a producer for each track kind an addTrack plan item may carry', () => {
        const kinds = ['audio', 'midi', 'folder'];

        const producers = kinds.map((kind) =>
            resolveBatchLocalBindingProducer({
                arguments: { kind, name: 'Aux' },
                context: projectContext,
                name: 'addTrack',
                producersByBinding: new Map(),
            })
        );

        expect(producers.map((producer) => producer?.trackKind)).toEqual(kinds);
    });

    it('refuses an inherited object key as a track kind', () => {
        const producer = resolveBatchLocalBindingProducer({
            arguments: { kind: 'toString', name: 'Aux' },
            context: projectContext,
            name: 'addTrack',
            producersByBinding: new Map(),
        });

        expect(producer).toBeNull();
    });
});
