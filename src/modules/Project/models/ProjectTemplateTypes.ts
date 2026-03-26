export type TemplateCategory = 'empty' | 'music' | 'podcast' | 'film' | 'demo';

export type ProjectTemplate = {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    platform?: 'web' | 'native';
    create: () => void | Promise<void>;
};
