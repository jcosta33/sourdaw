import { collaborationSessionRuntime } from './sessionManagement';

export async function generateInvite(): Promise<string> {
    return collaborationSessionRuntime.generateInvite();
}
