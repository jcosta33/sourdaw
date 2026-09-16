import { type DawProjectMeta } from './dawProjectTypes';
import { DAW_PROJECT_XML_TAGS } from './dawProjectXmlTagNames';
import { parseXml } from './parse-xml';
import { wrap } from './xmlHelpers';

const { ARTIST, COMMENT, TITLE } = DAW_PROJECT_XML_TAGS;

export function parseMetadataXml(xml: string): DawProjectMeta {
    try {
        const doc = parseXml(xml);
        const rootElement = doc.documentElement;
        if (!rootElement) {
            return defaultMeta();
        }
        const root = wrap(rootElement);
        return {
            title: root.child(TITLE)?.text().trim() ?? '',
            artist: root.child(ARTIST)?.text().trim() ?? '',
            comment: root.child(COMMENT)?.text().trim() ?? '',
        };
    } catch {
        return defaultMeta();
    }
}

function defaultMeta(): DawProjectMeta {
    return { title: '', artist: '', comment: '' };
}
