import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showGrandBoulePanel = inject({ eventBus: WorkspaceEventBus })( } from '../showGrandBoulePanel';
describe('export const showGrandBoulePanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showGrandBoulePanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
