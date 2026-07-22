import { describe, it, expect } from 'vitest';

// Single static import, on purpose: the Arrangement consumer initializes
// FIRST, and its own top-level import of '#/modules/WorkspaceShell/useCases'
// resolves the barrel inside the Arrangement-entry graph — the
// Arrangement-first direction the original test pinned. Importing the barrel
// statically before the consumer would mask that direction (and the lint
// import order would force exactly that masking).
import * as subject from '../setWorkspaceMode';

describe('setWorkspaceMode', () => {
    it('should export setWorkspaceMode', () => {
        expect(subject.setWorkspaceMode).toBeDefined();
        const time = typeof subject.setWorkspaceMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    // Relocated from WorkspaceShell's rippleEditing.spec.ts: there it
    // dynamically imported the ENTIRE Arrangement useCases barrel inside the
    // test body (>60 s under parallel load). The barrel below is already
    // initialized by the consumer's graph, so this import is cache-only.
    it('initializes the WorkspaceShell barrel through this Arrangement consumer without failure', async () => {
        const workspaceUseCases = await import('#/modules/WorkspaceShell/useCases');
        expect(subject.setWorkspaceMode).toBeDefined();
        expect(workspaceUseCases.setWorkspaceMode).toBeDefined();
    });
});
