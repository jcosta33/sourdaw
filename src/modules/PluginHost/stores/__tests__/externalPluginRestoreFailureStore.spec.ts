import { describe, it, expect, afterEach } from 'vitest';

import { clearExternalPluginRestoreFailure } from '../../useCases/pluginLifecycle/clearExternalPluginRestoreFailure';
import { hasUnresolvedExternalPluginRestoreFailure } from '../../useCases/pluginLifecycle/hasUnresolvedExternalPluginRestoreFailure';
import { markExternalPluginRestoreFailure } from '../../useCases/pluginLifecycle/markExternalPluginRestoreFailure';
import {
    defaultExternalPluginRestoreFailureState,
    externalPluginRestoreFailureStore,
} from '../externalPluginRestoreFailureStore';

describe('externalPluginRestoreFailureStore', () => {
    const SPEC_INSTANCE_ID = 'restore-failure-store-spec-instance';

    afterEach(() => {
        clearExternalPluginRestoreFailure(SPEC_INSTANCE_ID);
        externalPluginRestoreFailureStore.set(defaultExternalPluginRestoreFailureState);
    });

    it('starts at version zero with no failures', () => {
        expect(externalPluginRestoreFailureStore.getSnapshot() ?? defaultExternalPluginRestoreFailureState).toEqual({
            version: 0,
        });
    });

    it('bumps the version when a failure is published and when it resolves', () => {
        const versionAtStart = externalPluginRestoreFailureStore.getSnapshot()?.version ?? 0;

        markExternalPluginRestoreFailure(SPEC_INSTANCE_ID);
        expect(externalPluginRestoreFailureStore.getSnapshot()?.version).toBe(versionAtStart + 1);
        expect(hasUnresolvedExternalPluginRestoreFailure(SPEC_INSTANCE_ID)).toBe(true);

        clearExternalPluginRestoreFailure(SPEC_INSTANCE_ID);
        expect(externalPluginRestoreFailureStore.getSnapshot()?.version).toBe(versionAtStart + 2);
        expect(hasUnresolvedExternalPluginRestoreFailure(SPEC_INSTANCE_ID)).toBe(false);
    });
});
