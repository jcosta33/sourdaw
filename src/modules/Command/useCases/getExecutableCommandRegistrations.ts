import { executableAppActionDescriptors } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';

export function getExecutableCommandRegistrations() {
    const seenActionTypes = new Set<string>();
    return executableAppActionDescriptors.map((descriptor) => {
        if (seenActionTypes.has(descriptor.actionType)) {
            throw new Error(`Executable command is registered more than once: ${descriptor.actionType}`);
        }
        seenActionTypes.add(descriptor.actionType);
        return getExecutableCommandRegistration(descriptor.actionType);
    });
}
