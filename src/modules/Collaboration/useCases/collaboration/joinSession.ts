import { collaborationSessionRuntime } from './sessionManagement';

export async function joinSession(inviteString: string, name: string): Promise<string> {
    return collaborationSessionRuntime.joinSession(inviteString, name);
}
