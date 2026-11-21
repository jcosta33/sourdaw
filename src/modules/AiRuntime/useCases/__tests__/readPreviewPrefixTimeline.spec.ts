import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { getProjectContext } from '../getProjectContext';
import { readPreviewPrefixTimeline } from '../readPreviewPrefixTimeline';

import { resetMetricGoalProject } from './metricGoalWorkflowFixture';
import {
    compileTempoBatch,
    configureTempoMapProject,
    LIVE_TEMPO_MAP,
    PREFIX_TEMPO_MAP,
} from './prefixTempoBatchFixture';

registerDeviceEnginePorts();

const RUN_ID = 'read-preview-prefix-timeline';
const PROMPT = 'Double the tempo';

describe('reading the timeline of a preview prefix document', () => {
    beforeEach(() => {
        configureTempoMapProject(RUN_ID, []);
    });

    afterEach(() => {
        resetMetricGoalProject();
    });

    it('answers the tempo map the prefix leaves, not the live project’s, and leaves the live project untouched', () => {
        const { envelope } = compileTempoBatch(RUN_ID, PROMPT);
        expect(tempoMapStore.value?.changes).toEqual(LIVE_TEMPO_MAP);

        const before = captureProjectRevision();
        const timeline = readPreviewPrefixTimeline({
            prefix: 'batch',
            preparedBatch: envelope,
            projectRevision: envelope.baseRevision,
            preview: {
                context: getProjectContext(),
                prompt: PROMPT,
                runId: RUN_ID,
                readCreativeAuthority: () => undefined,
            },
        });

        expect(captureProjectRevision()).toBe(before);
        expect(timeline.changes).toEqual(PREFIX_TEMPO_MAP);
        expect(tempoMapStore.value?.changes).toEqual(LIVE_TEMPO_MAP);
        expect(transportStore.value?.tempo).toBe(120);
    });
});
