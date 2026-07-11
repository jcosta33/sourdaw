import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showGlutenPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showGlutenPanel';
describe('export const showGlutenPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showGlutenPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
