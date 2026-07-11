import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onPanelShowDutchOven = inject({ eventBus: WorkspaceEventBus })( } from '../onPanelShowDutchOven';
describe('export const onPanelShowDutchOven = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onPanelShowDutchOven = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
