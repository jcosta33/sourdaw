import { invokeCommand } from './helpers';

/** Create a new CRDT project via the native backend. */
export async function nativeCreateProject(name: string, sampleRate: number): Promise<boolean> {
    const result = await invokeCommand('collab_create_project', { name, sampleRate });
    return Boolean(result);
}
