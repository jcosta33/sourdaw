import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showBacteriaPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showBacteriaPanel';
describe('export const showBacteriaPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showBacteriaPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
