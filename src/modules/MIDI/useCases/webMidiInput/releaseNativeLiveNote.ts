import { sendNativeLiveMidiNote } from '#/modules/AudioEngine/useCases';

import type { ReleaseNativeLiveNote } from '../../repositories/webMidi/engineStripAccess';

// Fire-and-forget for the same reason a key release is: the caller (panic,
// reset, teardown) has already cleared its own bookkeeping, and there is
// nothing useful to do with a rejected release besides drop it.
export const releaseNativeLiveNote: ReleaseNativeLiveNote = (release) => {
    void sendNativeLiveMidiNote({ ...release, velocity: 0, isNoteOn: false });
};
