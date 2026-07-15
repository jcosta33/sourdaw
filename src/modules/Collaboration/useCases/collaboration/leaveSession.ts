import { collaborationSessionRuntime } from './sessionManagement';

export async function leaveSession(): Promise<void> {
    return collaborationSessionRuntime.leaveSession();
}
