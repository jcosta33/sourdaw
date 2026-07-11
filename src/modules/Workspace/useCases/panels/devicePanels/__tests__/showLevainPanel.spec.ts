import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showLevainPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showLevainPanel';
describe('export const showLevainPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showLevainPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
