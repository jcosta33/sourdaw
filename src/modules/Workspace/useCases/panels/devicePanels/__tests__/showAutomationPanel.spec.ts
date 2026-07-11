import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({ eventBus: { emit: vi.fn() } }) }));
import { export const showAutomationPanel = inject({ eventBus: WorkspaceEventBus })( } from '../showAutomationPanel';
describe('export const showAutomationPanel = inject({ eventBus: WorkspaceEventBus })(', () => {
    it('is defined', () => { expect(export const showAutomationPanel = inject({ eventBus: WorkspaceEventBus })().toBeDefined(); });
});
