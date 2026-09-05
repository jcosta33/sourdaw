import { beforeEach, describe, expect, it } from 'vitest';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { recordExternalPluginActivationError } from '../recordExternalPluginActivationError';

describe('recordExternalPluginActivationError', () => {
    beforeEach(() => {
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
    });

    it('writes an error entry for the target instance without touching another instance', () => {
        externalPluginActivationStore.set({
            byInstanceId: { 'other-instance': { status: 'active' } },
        });

        recordExternalPluginActivationError('target-instance', 'no sample rate to activate at');

        expect(externalPluginActivationStore.value?.byInstanceId['target-instance']).toEqual({
            status: 'error',
            message: 'no sample rate to activate at',
        });
        expect(externalPluginActivationStore.value?.byInstanceId['other-instance']).toEqual({ status: 'active' });
    });
});
