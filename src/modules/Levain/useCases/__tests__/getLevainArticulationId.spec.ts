import { describe, expect, it } from 'vitest';

import { ARTICULATION_ID_BY_TYPE } from '../../models/LevainPatch';
import { getLevainArticulationId } from '../getLevainArticulationId';

describe('getLevainArticulationId', () => {
    it('resolves every declared articulation to the id the engine voices it with', () => {
        // The ids are a wire contract: a project stores one against a note and
        // the engine's `note_on_with_channel_and_articulation` receives it, so
        // renumbering one changes what saved projects sound like. Driving the
        // whole table rather than three samples is what makes a renumbering
        // visible here.
        for (const [name, id] of Object.entries(ARTICULATION_ID_BY_TYPE)) {
            expect(getLevainArticulationId(name)).toBe(id);
        }
    });

    it('refuses a name Levain does not ship', () => {
        expect(getLevainArticulationId('accent')).toBeNull();
        expect(getLevainArticulationId('')).toBeNull();
    });

    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
        'refuses the inherited property name %s instead of returning it as an id',
        (inherited) => {
            // The name comes out of a project file, where any printable string
            // is accepted. An unguarded index on an object literal resolves an
            // inherited key to a function, which is not nullish — so `?? null`
            // never fires and the function reaches `port.postMessage` typed as
            // a number, where the structured clone throws and kills the note.
            expect(getLevainArticulationId(inherited)).toBeNull();
        }
    );
});
