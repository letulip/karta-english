import type { WritingTask } from './types';

export const WRITING: WritingTask[] = [
  {
    id: 'w1-letter',
    title: 'Письмо рекрутёру',
    minutes: 20,
    minWords: 150,
    format: 'Формат IELTS General, Task 1: письмо по трём пунктам, полуофициальный тон.',
    prompt: [
      'You have applied for a forward-deployed engineering role at an AI company in San Francisco. The recruiter, Sarah, has emailed you to arrange a first video call. Unfortunately, all the times she suggested fall in the middle of your night because of the time difference.',
      'Write an email to Sarah. In your email:',
    ],
    bullets: [
      'thank her and confirm that you are still interested in the role',
      'explain why the suggested times do not work and propose some alternatives',
      'ask two questions about the next steps of the hiring process',
    ],
    closing: 'Write at least 150 words. Begin your email: Dear Sarah,',
  },
  {
    id: 'w2-explain',
    title: 'Объяснение нетехническому клиенту',
    minutes: 15,
    minWords: 150,
    maxWords: 200,
    format: 'Рабочая переписка: объяснить техническую вещь человеку без технического образования.',
    prompt: [
      'You are working with a logistics company. Their operations manager, who has no technical background, sends you this message:',
      '“My team keeps hearing that AI assistants sometimes make things up. Why does that happen? And how will your system make sure my staff can trust its answers?”',
      'Write a reply that a non-technical reader will understand. Avoid jargon; if you need a technical term, explain it in plain words.',
    ],
    closing: 'Write 150–200 words.',
  },
  {
    id: 'w3-essay',
    title: 'Эссе',
    minutes: 40,
    minWords: 250,
    format: 'Формат IELTS, Writing Task 2: эссе-рассуждение с собственным мнением.',
    prompt: [
      'Some people believe that children should start learning a foreign language at primary school. Others think it is better to start at secondary school, when children are older.',
      'Discuss both views and give your own opinion.',
    ],
    closing:
      'Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words.',
  },
];
