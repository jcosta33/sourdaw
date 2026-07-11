import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showCrumbsPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showCrumbsPanel';
describe('export const showCrumbsPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showCrumbsPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
