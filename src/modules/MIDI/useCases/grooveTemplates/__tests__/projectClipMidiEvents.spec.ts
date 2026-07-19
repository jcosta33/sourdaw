import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { assignGrooveTemplate } from '../assignGrooveTemplate';
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
        expect(projected?.duration).toBeCloseTo(0.25, 12);
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
});
