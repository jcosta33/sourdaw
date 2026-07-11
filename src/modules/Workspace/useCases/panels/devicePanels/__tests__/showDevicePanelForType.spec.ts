import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showDevicePanelForType = inject({ eventBus: WorkspaceEventBus })( } from '../showDevicePanelForType';
describe('export const showDevicePanelForType = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showDevicePanelForType = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
