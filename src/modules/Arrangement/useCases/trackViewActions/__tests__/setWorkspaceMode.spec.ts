import { describe, it, expect } from 'vitest';

import * as workspaceUseCases from '#/modules/WorkspaceShell/useCases';

import * as subject from '../setWorkspaceMode';

describe('setWorkspaceMode', () => {
    it('should export setWorkspaceMode', () => {
        expect(subject.setWorkspaceMode).toBeDefined();
        const time = typeof subject.setWorkspaceMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    // Relocated from WorkspaceShell's rippleEditing.spec.ts: there it
    // dynamically imported the ENTIRE Arrangement useCases barrel inside the
    // test body (>60 s under parallel load). The regression it pins is this
    // consumer's import of the WorkspaceShell barrel initializing cleanly —
    // static imports at collection time pin that with no per-test timeout
    // exposure.
    it('initializes the WorkspaceShell barrel through this Arrangement consumer without failure', () => {
        expect(subject.setWorkspaceMode).toBeDefined();
        expect(workspaceUseCases.setWorkspaceMode).toBeDefined();
    });
});
