import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showCrustPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showCrustPanel';
describe('export const showCrustPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showCrustPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
