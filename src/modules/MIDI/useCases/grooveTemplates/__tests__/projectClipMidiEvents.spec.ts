import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { assignGrooveTemplate } from '../assignGrooveTemplate';
import { createGrooveMidiEventProjector } from '../createGrooveMidiEventProjector';
import { createGrooveTemplate } from '../createGrooveTemplate';
import { projectClipMidiEvents } from '../projectClipMidiEvents';

describe('projectClipMidiEvents', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: 'clip-push',
            name: 'Clip push',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: -0.4, dynamicsOffset: 0.1 }],
            provenance: { type: 'user', sourceId: 'clip-push' },
        });
        createGrooveTemplate({
            id: 'sequence-push',
            name: 'Sequence push',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: -0.4, dynamicsOffset: 0.1 }],
            provenance: { type: 'user', sourceId: 'sequence-push' },
        });
        assignGrooveTemplate({ consumerType: 'clip', consumerId: 'clip-a', templateId: 'clip-push', amount: 1 });
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'sequence-push',
            amount: 1,
        });
    });

    it('composes clip-relative and absolute sequencer projection before applying one clip boundary policy', () => {
        const [projected] = projectClipMidiEvents({
            events: [{ id: 'n1', startBeat: 0, duration: 0.25, velocity: 80 }],
            clipId: 'clip-a',
            clipStartBeat: 4,
            clipEndBeat: 8,
            iterationStartBeat: 4,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        expect(projected).toEqual(expect.objectContaining({ id: 'n1', startBeat: 4, velocity: 106 }));
        expect(projected?.duration).toBeCloseTo(0.05, 12);
    });

    it('wraps a looping interval across the loop edge without losing either segment', () => {
        const projected = projectClipMidiEvents({
            events: [{ id: 'wrapped', startBeat: 0, duration: 0.25, velocity: 80 }],
            clipId: 'clip-a',
            clipStartBeat: 4,
            clipEndBeat: 8,
            iterationStartBeat: 4,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            loopEnabled: true,
        });

        expect(projected).toHaveLength(2);
        expect(projected[0]).toEqual(expect.objectContaining({ id: 'wrapped', startBeat: 4 }));
        expect(projected[0]?.duration).toBeCloseTo(0.05, 12);
        expect(projected[1]).toEqual(expect.objectContaining({ id: 'wrapped', startBeat: 7.8 }));
        expect(projected[1]?.duration).toBeCloseTo(0.2, 12);
    });

    it('drops a non-looping interval moved completely before the clip', () => {
        expect(
            projectClipMidiEvents({
                events: [{ id: 'outside', startBeat: 0, duration: 0.1, velocity: 80 }],
                clipId: 'clip-a',
                clipStartBeat: 4,
                clipEndBeat: 8,
                iterationStartBeat: 4,
                loopLengthBeats: 4,
                midiOffsetBeats: 0,
            })
        ).toEqual([]);
    });

    it('uses the identical end clamp for projected notes at the far clip edge', () => {
        const [projected] = projectClipMidiEvents({
            events: [{ id: 'n2', startBeat: 3.95, duration: 0.25, velocity: 80 }],
            clipId: 'clip-a',
            clipStartBeat: 4,
            clipEndBeat: 8,
            iterationStartBeat: 4,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        });
        expect(projected).toEqual(expect.objectContaining({ id: 'n2', startBeat: 7.85, velocity: 93 }));
        expect(projected?.duration).toBeCloseTo(0.15, 12);
    });

    it('binds projection to an immutable groove snapshot', () => {
        const projectSnapshot = createGrooveMidiEventProjector();
        const input = {
            events: [{ id: 'snapshot-note', startBeat: 0, duration: 0.25, velocity: 80 }],
            clipId: 'clip-a',
            clipStartBeat: 4,
            clipEndBeat: 8,
            iterationStartBeat: 4,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
        };
        const [snapshotBeforeMutation] = projectSnapshot(input);

        createGrooveTemplate({
            id: 'late-pocket',
            name: 'Late pocket',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: 0.4, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'late-pocket' },
        });
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'clip-a',
            templateId: 'late-pocket',
            amount: 1,
        });
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'late-pocket',
            amount: 1,
        });

        const [snapshotAfterMutation] = projectSnapshot(input);
        const [liveNote] = projectClipMidiEvents(input);

        expect(snapshotBeforeMutation?.startBeat).toBeCloseTo(4, 12);
        expect(snapshotAfterMutation).toEqual(snapshotBeforeMutation);
        expect(liveNote?.startBeat).toBeCloseTo(4.2, 12);
    });
});
