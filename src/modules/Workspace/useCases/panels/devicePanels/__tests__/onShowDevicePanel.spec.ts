import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const onShowDevicePanel = inject({ eventBus: WorkspaceEventBus })( } from '../onShowDevicePanel';
describe('export const onShowDevicePanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const onShowDevicePanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
