import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../stores/grooveTemplateStore';
import { assignGrooveTemplate } from '../useCases/grooveTemplates/assignGrooveTemplate';
import { createGrooveTemplate } from '../useCases/grooveTemplates/createGrooveTemplate';
import { previewGrooveTemplate } from '../useCases/grooveTemplates/previewGrooveTemplate';
import { projectCommittedGroove } from '../useCases/grooveTemplates/projectCommittedGroove';

describe('groove preview and commit parity', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('uses the same projection and commits only the owning reference', () => {
        const template = createGrooveTemplate({
            id: 'shuffle',
            name: 'Shuffle',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        const events = [{ id: 'n1', startBeat: 0.25, velocity: 100 }];
        const sourceSnapshot = structuredClone(events);
        const preview = previewGrooveTemplate({ events, templateId: template.id, amount: 0.5 });

        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'clip-1',
            templateId: template.id,
            amount: 0.5,
        });
        const committed = projectCommittedGroove({ events, consumerType: 'clip', consumerId: 'clip-1' });

        expect(committed).toEqual(preview);
        expect(events).toEqual(sourceSnapshot);
        expect(grooveTemplateStore.value?.assignments).toEqual([
            { consumerType: 'clip', consumerId: 'clip-1', templateId: 'shuffle', amount: 0.5 },
        ]);
    });
});
