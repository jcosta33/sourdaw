import { type DawProjectMeta } from './dawProjectTypes';
import { parseXml, wrap } from './xmlHelpers';

export function parseMetadataXml(xml: string): DawProjectMeta {
    try {
        const doc = parseXml(xml);
        const rootElement = doc.documentElement;
        if (!rootElement) {
            return defaultMeta();
        }
        const root = wrap(rootElement);
        return {
            title: root.child('Title')?.text().trim() ?? '',
            artist: root.child('Artist')?.text().trim() ?? '',
            comment: root.child('Comment')?.text().trim() ?? '',
        };
    } catch {
        return defaultMeta();
    }
}

function defaultMeta(): DawProjectMeta {
    return { title: '', artist: '', comment: '' };
}
