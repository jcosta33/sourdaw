import { afterEach, describe, expect, it } from 'vitest';

import { adjustmentLayerStore } from '#/modules/Arrangement/stores';
import { commandBatchPreflightPort } from '#/modules/Command/useCases';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

describe('AI workflow command preflight fixture', () => {
    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        adjustmentLayerStore.set({ layers: [] });
    });

    it('does not backfill a missing staged target from the live projection', () => {
        adjustmentLayerStore.set({
            layers: [
                {
                    id: 'layer-live-only',
                    name: 'Live only',
                    effectType: 'eq',
                    parameters: [],
                    affectedTrackIds: [],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#ffffff',
                },
            ],
        });
        configureAiWorkflowCommandPreflightFixture('project-test');

        const captured = commandBatchPreflightPort.capture({
            assetReferences: [],
            projectDocument: {},
            targetIds: ['layer-live-only'],
        });

        expect(captured?.targetFingerprints).toEqual({});
    });
});
