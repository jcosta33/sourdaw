import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showYeastPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showYeastPanel';
describe('export const showYeastPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showYeastPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
