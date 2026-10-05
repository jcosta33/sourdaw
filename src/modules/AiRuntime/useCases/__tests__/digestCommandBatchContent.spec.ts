import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandTrackDefaultsPort, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { digestCommandBatchContent } from '../digestCommandBatchContent';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
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

type Binding = { bindingId: string; producerActionIndex: number; producerArgument: string };

const TWO_BUSES: AppAction[] = [
    { type: 'createBus', payload: { name: 'Bus A', busId: 'bus-a' } },
    { type: 'createBus', payload: { name: 'Bus B', busId: 'bus-b' } },
];

/** Two buses created by one batch, with the batch-local bindings `bindings` wired over them. */
function digestTwoBuses(bindings: readonly Binding[]): string {
    return digestBatch(TWO_BUSES, bindings);
}

/** One batch of `actions`, compiled afresh, with the batch-local bindings `bindings` wired over it. */
function digestBatch(actions: readonly AppAction[], bindings: readonly Binding[]): string {
    const { commandBatch } = compilePlannedActionCommandBatch({
        actions,
        actionCommandGraph: {
            dependenciesByActionIndex: actions.map((): number[] => []),
            batchLocalBindings: [...bindings],
        },
        actionLabels: actions.map((action) => action.type),
        autoCommit: false,
        context,
        group: { groupId: 'group-buses', groupLabel: 'Two buses' },
        intent: 'Create two buses.',
        mode: 'preview',
        projectRevision: 'revision-1',
        runId: 'run-buses',
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return digestCommandBatchContent(parsed.envelope);
}

beforeEach(() => {
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
});

afterEach(() => {
    clearHandlerRegistry();
});

// Each row is red when the digest leaves out which command and argument produce a binding: the
// two batches carry the same commands, and only the binding wiring tells them apart.
describe('digestCommandBatchContent', () => {
    it('hashes two compilations of one batch alike', () => {
        const bindings = [
            { bindingId: '$x', producerActionIndex: 0, producerArgument: 'busId' },
            { bindingId: '$y', producerActionIndex: 1, producerArgument: 'busId' },
        ];

        expect(digestTwoBuses(bindings)).toBe(digestTwoBuses(bindings));
    });

    it('tells apart batches whose bindings resolve to different producer commands', () => {
        const wired = digestTwoBuses([
            { bindingId: '$x', producerActionIndex: 0, producerArgument: 'busId' },
            { bindingId: '$y', producerActionIndex: 1, producerArgument: 'busId' },
        ]);
        const rewired = digestTwoBuses([
            { bindingId: '$x', producerActionIndex: 1, producerArgument: 'busId' },
            { bindingId: '$y', producerActionIndex: 0, producerArgument: 'busId' },
        ]);

        expect(rewired).not.toBe(wired);
    });

    it('tells apart batches whose bindings resolve to different producer arguments', () => {
        // A new track mints its own id and its first alternative's, so one command produces both.
        const addTrack: AppAction[] = [{ type: 'addTrack', payload: { id: 'track-a', name: 'A', kind: 'audio' } }];
        const wired = digestBatch(addTrack, [
            { bindingId: '$x', producerActionIndex: 0, producerArgument: 'id' },
            { bindingId: '$y', producerActionIndex: 0, producerArgument: 'initialAlternativeId' },
        ]);
        const rewired = digestBatch(addTrack, [
            { bindingId: '$x', producerActionIndex: 0, producerArgument: 'initialAlternativeId' },
            { bindingId: '$y', producerActionIndex: 0, producerArgument: 'id' },
        ]);

        expect(rewired).not.toBe(wired);
    });
});
