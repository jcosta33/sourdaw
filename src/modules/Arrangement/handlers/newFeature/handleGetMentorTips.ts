import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { generateMentorLessons } from '#/modules/AiRuntime/useCases';

export const handleGetMentorTips = createHandler<'getMentorTips'>({
    execute: () => {
        const lessons = generateMentorLessons();
        if (lessons.length > 0) {
            const tip = lessons[0]!;
            notifyUser(`🎓 ${tip.title}: ${tip.observation} — ${tip.advice}`);
        } else {
            notifyUser('No mentor tips at this time — looking good!', 'success');
        }
    },
    describe: () => ({ label: 'Get Mentor Tips' }),
    undoable: false,
});
