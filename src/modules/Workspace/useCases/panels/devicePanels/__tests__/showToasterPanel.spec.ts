import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showToasterPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showToasterPanel';
describe('export const showToasterPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showToasterPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
