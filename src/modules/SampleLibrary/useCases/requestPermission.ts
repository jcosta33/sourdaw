import { requestPermission as requestPermissionFromRepo } from '../repositories/libraryPersistence/requestPermission';

/**
 * Request file system permission for a browser directory handle that needs
 * re-authorisation. Returns true if permission was granted.
 */
export async function requestPermission(rootId: string): Promise<boolean> {
    return requestPermissionFromRepo(rootId);
}
