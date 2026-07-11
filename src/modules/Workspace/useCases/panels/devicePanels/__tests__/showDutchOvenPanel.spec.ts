import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showDutchOvenPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showDutchOvenPanel';
describe('export const showDutchOvenPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showDutchOvenPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
