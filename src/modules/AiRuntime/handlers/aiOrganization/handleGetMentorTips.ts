import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { generateMentorLessons } from '../../useCases/musicMentor/generateLessons';

export const handleGetMentorTips = createHandler<'getMentorTips'>({
    execute: () => {
        const lessons = generateMentorLessons();
        if (lessons.length > 0) {
            const tip = lessons[0]!;
            notifyUser(`🎓 ${tip.title}: ${tip.observation} — ${tip.advice}`);
            return;
        }

        notifyUser('No mentor tips at this time — looking good!', 'success');
    },
    describe: () => ({ label: 'Get Mentor Tips' }),
    undoable: false,
});
