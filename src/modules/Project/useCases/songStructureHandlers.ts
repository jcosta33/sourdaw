import { type ActionHandler } from '#/modules/Command/models/ActionHandler';
import { detectAndApplySongStructure } from '#/modules/Timeline/useCases/songStructureDetection';

export const songStructureHandlers: Record<string, ActionHandler<any>> = {
    detectSongStructure: {
        execute: async (a: { payload: { trackId?: string } }) => {
            const sections = detectAndApplySongStructure(a.payload.trackId);
            if (sections.length === 0) {
                document.dispatchEvent(
                    new CustomEvent('webdaw:notify', {
                        detail: {
                            message: 'No clips found to analyze — add some clips first',
                            level: 'warning',
                        },
                    })
                );
            } else {
                document.dispatchEvent(
                    new CustomEvent('webdaw:notify', {
                        detail: {
                            message: `Detected ${sections.length} sections: ${sections.map((s) => s.name).join(', ')}`,
                            level: 'success',
                        },
                    })
                );
            }
        },
        undoable: true,
        describe: () => ({ label: 'Detect Song Structure' }),
    },
};
