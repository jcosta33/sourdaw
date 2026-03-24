import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type DawProjectTrack, type DawProjectClip, type DawProjectDocument } from '#/modules/Project/models/DawProjectTypes';

const logger = Container.getInstance().get(Logger);

/**
 * Parse a DAWproject XML string into our intermediate format.
 * Logs warnings when attributes are missing and defaults are used.
 */
export function parseDawProjectXml(xml: string): DawProjectDocument | null {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const root = xmlDoc.documentElement;

        if (root.tagName !== 'DAWProject') {
            logger.warn('Invalid DAWproject: root element is not DAWProject');
            return null;
        }

        const version = root.getAttribute('version') ?? '1.0';

        const timelineEl = root.querySelector('Timeline');
        if (!timelineEl) {
            logger.warn('DAWproject: missing Timeline element, using defaults');
        }
        const bpm = parseFloat(timelineEl?.getAttribute('bpm') ?? '120');
        const tsNum = parseInt(timelineEl?.getAttribute('timeSignatureNumerator') ?? '4', 10);
        const tsDen = parseInt(timelineEl?.getAttribute('timeSignatureDenominator') ?? '4', 10);

        const tracks: DawProjectTrack[] = [];
        const trackEls = root.querySelectorAll('Tracks > Track');
        trackEls.forEach((el) => {
            if (!el.getAttribute('id')) {
                logger.warn(`DAWproject: track missing 'id' attribute, skipping`);
                return;
            }
            tracks.push({
                id: el.getAttribute('id')!,
                name: el.getAttribute('name') ?? 'Untitled',
                type: (el.getAttribute('type') as DawProjectTrack['type']) ?? 'audio',
                color: el.getAttribute('color') ?? '#808080',
                volume: parseFloat(el.getAttribute('volume') ?? '0.8'),
                pan: parseFloat(el.getAttribute('pan') ?? '0'),
                muted: el.getAttribute('muted') === 'true',
                solo: el.getAttribute('solo') === 'true',
            });
        });

        const clips: DawProjectClip[] = [];
        const clipEls = root.querySelectorAll('Clips > Clip');
        clipEls.forEach((el) => {
            const notes: DawProjectClip['notes'] = [];
            const noteEls = el.querySelectorAll('Note');
            noteEls.forEach((noteEl) => {
                notes.push({
                    pitch: parseInt(noteEl.getAttribute('pitch') ?? '60', 10),
                    velocity: parseInt(noteEl.getAttribute('velocity') ?? '100', 10),
                    startBeat: parseFloat(noteEl.getAttribute('startBeat') ?? '0'),
                    durationBeats: parseFloat(noteEl.getAttribute('duration') ?? '1'),
                });
            });

            clips.push({
                trackId: el.getAttribute('trackId') ?? '',
                name: el.getAttribute('name') ?? '',
                startBeat: parseFloat(el.getAttribute('startBeat') ?? '0'),
                durationBeats: parseFloat(el.getAttribute('duration') ?? '4'),
                mediaRef: el.getAttribute('mediaRef') ?? null,
                notes,
            });
        });

        return { version, application: 'External', timeline: { bpm, timeSignatureNumerator: tsNum, timeSignatureDenominator: tsDen }, tracks, clips };
    } catch (err) {
        logger.error(err instanceof Error ? err : new Error(`Failed to parse DAWproject XML: ${String(err)}`));
        return null;
    }
}
