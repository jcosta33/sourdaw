export function parseXml(source: string): Document {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, 'application/xml');
    const errorNode = doc.getElementsByTagName('parsererror')[0];
    if (errorNode) {
        throw new Error(`Invalid XML: ${errorNode.textContent ?? 'unknown parse error'}`);
    }
    return doc;
}
