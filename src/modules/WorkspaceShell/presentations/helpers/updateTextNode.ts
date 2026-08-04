/**
 * Updates a text-only element without replacing its Text node on every frame.
 * Preserving node identity avoids detached-node allocation and its associated
 * garbage-collection pressure in hot presentation loops.
 */
export function updateTextNode(element: HTMLElement | null, value: string): void {
    if (!element) {
        return;
    }

    const textNode = element.firstChild;
    const hasSingleTextNode = textNode?.nodeType === Node.TEXT_NODE && textNode.nextSibling === null;
    if (hasSingleTextNode) {
        if (textNode.nodeValue !== value) {
            textNode.nodeValue = value;
        }
        return;
    }

    element.replaceChildren(value);
}
