export type XmlQuery = {
    element: Element;
    attr: (name: string) => string | null;
    attrNumber: (name: string, fallback: number) => number;
    attrBool: (name: string, fallback: boolean) => boolean;
    child: (tag: string) => XmlQuery | null;
    children: (tag?: string) => XmlQuery[];
    text: () => string;
};

export function wrap(element: Element): XmlQuery {
    return {
        element,
        attr: (name) => element.getAttribute(name),
        attrNumber: (name, fallback) => {
            const raw = element.getAttribute(name);
            if (raw === null) {
                return fallback;
            }
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : fallback;
        },
        attrBool: (name, fallback) => {
            const raw = element.getAttribute(name);
            if (raw === null) {
                return fallback;
            }
            return raw === 'true' || raw === '1';
        },
        child: (tag) => {
            const found = Array.from(element.children).find((kid) => kid.tagName === tag);
            return found ? wrap(found) : null;
        },
        children: (tag) => {
            const kids = Array.from(element.children);
            const filtered = tag === undefined ? kids : kids.filter((kid) => kid.tagName === tag);
            return filtered.map(wrap);
        },
        text: () => element.textContent ?? '',
    };
}

export function parseXml(source: string): Document {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, 'application/xml');
    const errorNode = doc.getElementsByTagName('parsererror')[0];
    if (errorNode) {
        throw new Error(`Invalid XML: ${errorNode.textContent ?? 'unknown parse error'}`);
    }
    return doc;
}
