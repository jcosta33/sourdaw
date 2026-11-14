import { getExecutableAppActionEffect } from '#/modules/Command/useCases';

/** Whether a command of this type creates an object, as its declared effect says. */
export function createsObjects(actionType: string): boolean {
    return (getExecutableAppActionEffect(actionType)?.creates ?? []).length > 0;
}
