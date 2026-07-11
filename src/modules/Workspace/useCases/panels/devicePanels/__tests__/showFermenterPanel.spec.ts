import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showFermenterPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showFermenterPanel';
describe('export const showFermenterPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showFermenterPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
