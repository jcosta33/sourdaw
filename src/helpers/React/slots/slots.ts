/* (c) Copyright Frontify Ltd., all rights reserved. */

import { Children, type JSXElementConstructor, type ReactElement, type ReactNode, isValidElement } from 'react';

type ForwardRefType = {
    displayName: string;
};

const isForwardRefType = (obj: unknown): obj is ForwardRefType => {
    if (obj === null || typeof obj !== 'object') {
        return false;
    }

    return (
        '$$typeof' in obj &&
        obj.$$typeof === Symbol.for('react.forward_ref') &&
        'displayName' in obj &&
        typeof obj.displayName === 'string'
    );
};

/**
 * Organizes React children into an array based on their component types
 *
 * @param children - The React children to process
 * @param components - Array of Components
 * @returns An array of React nodes, where the index corresponds to the slot position
 *
 * @example
 * ```tsx
 * const [header, footer, root] = getSlotsFromChildren(children, [HeaderComponent, FooterComponent]);
 * return (
 *  <header>
 *      {header}
 *   </header>
 *   <main>
 *      {root}
 *   </main>
 *   <footer>
 *      {footer}
 *   </footer>
 * );
 * ```
 */
export function getSlotsByComponentType(
    children: ReactNode,
    components: JSXElementConstructor<never>[]
): readonly [
    ...ReactElement<{ children?: unknown } & Record<string, string>>[],
    ReactElement<{ children?: unknown }>[],
] {
    const slots = Array.from({ length: components.length }).fill(null) as ReactElement[];

    const unassigned: ReactElement[] = [];

    Children.forEach(children, (child) => {
        if (isValidElement(child)) {
            const indexOf = components.findIndex((component) => {
                const childType = child.type;

                if (typeof childType === 'function' && childType.name === component.name) {
                    return true;
                }

                if (
                    isForwardRefType(component) &&
                    isForwardRefType(childType) &&
                    childType.displayName === component.displayName
                ) {
                    return true;
                }

                return false;
            });

            if (indexOf !== -1) {
                slots[indexOf] = child;
            } else {
                unassigned.push(child);
            }
        }
    });

    return [...slots, unassigned];
}
