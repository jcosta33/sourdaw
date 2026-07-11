import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showProofPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showProofPanel';
describe('export const showProofPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showProofPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
