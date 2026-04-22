import { runAppAction } from './src/modules/AiRuntime/useCases/aiPanelActions/runAppAction';
type T = Parameters<typeof runAppAction>[0];
export const x: T = { type: 'test' } as unknown as T;
