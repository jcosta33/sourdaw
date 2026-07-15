import { destroyYeastRuntime } from '../engine/yeastRuntime';

export function teardownYeastRuntime(): void {
    destroyYeastRuntime();
}
