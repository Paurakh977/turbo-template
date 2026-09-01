export interface GeneratedNote {
  title: string;
  content: string;
}

const TOPICS = ['Roadmap', 'Sprint', 'Idea', 'Bug', 'Note', 'Draft', 'Plan'];

export function makeNote(): GeneratedNote {
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const id = Math.floor(Math.random() * 9000) + 1000;
  return {
    title: `${topic} ${id}`,
    content: `E2E generated content for ${topic} ${id}.`,
  };
}
