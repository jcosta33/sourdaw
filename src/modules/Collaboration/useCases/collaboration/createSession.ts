import { collaborationSessionRuntime } from './sessionManagement';

export function createSession(name: string): string {
    return collaborationSessionRuntime.createSession(name);
}
