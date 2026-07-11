import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showScoringPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showScoringPanel';
describe('export const showScoringPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showScoringPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
