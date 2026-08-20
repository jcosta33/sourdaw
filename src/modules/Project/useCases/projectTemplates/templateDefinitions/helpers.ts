import { demo5_NebulaDrift } from '../../demoProjects/nebulaDrift/createNebulaDriftDemo';
import { newProject } from '../../projectPersistence/newProject';
import { createAmbientTemplate } from '../templateFiles/ambient';
import { createCinematicTemplate } from '../templateFiles/cinematic';
import { createEdmTemplate } from '../templateFiles/edm';
import { createHipHopTrapTemplate } from '../templateFiles/hipHopTrap';
import { createLofiTemplate } from '../templateFiles/lofi';
import { createPodcastTemplate } from '../templateFiles/podcast';
import { createPopSongTemplate } from '../templateFiles/popSong';
import { createRockBandTemplate } from '../templateFiles/rockBand';
import { createSingerSongwriterTemplate } from '../templateFiles/singerSongwriter';

export type TemplateCategory = 'empty' | 'music' | 'podcast' | 'film' | 'demo';

export type ProjectTemplate = {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    executionBoundary: 'app-action' | 'project-replacement';
    platform?: 'web' | 'native';
    create: () => Promise<boolean>;
};

async function createSuccessfulTemplate(create: () => Promise<void> | void): Promise<boolean> {
    await create();
    return true;
}

export const templates: ProjectTemplate[] = [
    {
        id: 'empty',
        name: 'Empty Project',
        description: 'A blank canvas — no tracks, no devices.',
        category: 'empty',
        executionBoundary: 'project-replacement',
        create: () => newProject('Untitled'),
    },
    {
        id: 'pop-song',
        name: 'Pop Song',
        description:
            '100 BPM C major. Drums folder, bass with kick sidechain, rhythm layer, vocal stack with Knead pitch correction, warm pad, plate/hall/tape-delay sends, drum and vocal buses, and a pop-tuned master chain.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createPopSongTemplate),
    },
    {
        id: 'hiphop-trap',
        name: 'Hip-Hop / Trap',
        description:
            '140 BPM F minor. Trap drum folder, 808 sub with heavy kick ducking, Rhodes/flute/pad melodies, lead + ad-lib + hook vocals through a broadcast vocal bus, plate/hall/tape-delay sends, and a trap-glue master chain.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createHipHopTrapTemplate),
    },
    {
        id: 'edm',
        name: 'EDM',
        description:
            '128 BPM C minor, 128-beat arrangement with Intro/Build/Drop markers. Classic Kick→Bass and Kick→Pad sidechain, supersaw/pluck/Yeast-arp leads, fermenter atmos pad, parallel comp + plate/hall/delay sends, gluten + brickwall + proof master.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createEdmTemplate),
    },
    {
        id: 'rock-band',
        name: 'Rock Band',
        description:
            '120 BPM E minor. Kick/snare/hat/overheads/tom drum folder into NY-comp drum bus, Grinder amp sims on panned rhythm + lead guitars through a room-IR guitar bus, vocal stack, plate/hall/tape sends, bacteria + gluten + brickwall master.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createRockBandTemplate),
    },
    {
        id: 'lofi',
        name: 'Lo-fi',
        description:
            '80 BPM D Dorian with heavy MPC-60 swing. Lo-fi drum kit + vinyl crackle, sub bass, Rhodes/pluck/pad melodic folder, tape-hiss + wobble textures, spring reverb + tape delay + vinyl (bitcrush) bus, bitcrusher-warm master.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createLofiTemplate),
    },
    {
        id: 'cinematic',
        name: 'Cinematic',
        description:
            '90 BPM D minor, 96 beats with a 6/8 bridge at beat 48 and tempo rall. at the coda. Levain strings/cello, brass lead + French horn, flute/clarinet winds, soft keys, timpani + percussion, hall/plate/delay sends, cinematic master.',
        category: 'film',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createCinematicTemplate),
    },
    {
        id: 'podcast',
        name: 'Podcast',
        description:
            'Three mic tracks (host + 2 guests) with de-esser, broadcast EQ and compressor, into a voice bus with limiter. Host mic sidechain-ducks the music bus (intro/outro/sting). No reverb on voice. Gluten + limiter master targeting -16 LUFS.',
        category: 'podcast',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createPodcastTemplate),
    },
    {
        id: 'singer-songwriter',
        name: 'Singer-Songwriter',
        description:
            '90 BPM G major. Lead + harmony vocal stack with Knead, acoustic guitar, soft keys, sub bass, plate short/long + slap delay sends, gentle gluten + proof-warm master.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createSingerSongwriterTemplate),
    },
    {
        id: 'ambient',
        name: 'Ambient',
        description:
            '60 BPM C Lydian, 128 beats. Three Fermenter drones, Levain + FM shimmer pads, DX bell / soft keys / Crumbs granular melodic layer, tape-hiss texture, 8-second Cathedral reverb + tape delay + spring sends.',
        category: 'music',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(createAmbientTemplate),
    },
    {
        id: 'demo-nebula-drift',
        name: 'Nebula Drift',
        description:
            'A ~5-minute Tangerine Dream–style journey: Fermenter drones, pluck/grain textures, Levain lines, Naan Sitar lead, Pullman Organ lead, Rye Reese bass, and a full 16-pad Toaster kit (folder-hosted) with heavy automation and spatial FX.',
        category: 'demo',
        executionBoundary: 'app-action',
        create: () => createSuccessfulTemplate(demo5_NebulaDrift),
    },
];
