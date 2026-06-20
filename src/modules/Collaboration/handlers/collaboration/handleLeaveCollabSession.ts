import { createHandler } from '#/utils/createHandler';

import { leaveSession } from '../../useCases/collaboration/sessionManagement';

export const handleLeaveCollabSession = createHandler<'leaveCollabSession'>({
    execute: () => {
        // leaveSession is async (it flushes the buffered peer-leave before
        // tearing channels down); this handler is fire-and-forget, so cleanup
        // proceeds without awaiting the flush.
        void leaveSession();
    },
    describe: () => ({ label: 'Leave collaboration session' }),
    undoable: false,
});
