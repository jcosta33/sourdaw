import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showDevicePanel = inject({ eventBus: WorkspaceEventBus })( } from '../showDevicePanel';
describe('export const showDevicePanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showDevicePanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
