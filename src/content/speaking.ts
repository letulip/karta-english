import type { SpeakingPrompt, SpeakingType, Voice } from './types';

const RETELL_TASK =
  'Перескажи сообщение так, как пересказал бы своему тимлиду, и скажи, что спросишь у клиента, когда перезвонишь.';

// Вопросы озвучены голосами macOS (npm run audio): британский экзаменатор, американский рекрутёр,
// австралийский и индийский клиенты — те акценты, которые встретятся на созвонах в APAC.
export const SPEAKING: SpeakingPrompt[] = [
  { id: 'p1-1', type: 'part1', voice: 'Daniel', prepSec: 0, maxSec: 45, text: "Let's talk about where you live. Can you describe the place where you live now?" },
  { id: 'p1-2', type: 'part1', voice: 'Daniel', prepSec: 0, maxSec: 45, text: 'What do you usually do on a typical weekday morning?' },
  { id: 'p1-3', type: 'part1', voice: 'Daniel', prepSec: 0, maxSec: 45, text: 'Do you prefer to spend your free time alone or with other people? Why?' },
  { id: 'p1-4', type: 'part1', voice: 'Daniel', prepSec: 0, maxSec: 45, text: 'When was the last time you learned something new outside of work? What was it?' },
  {
    id: 'p2-1',
    type: 'part2',
    voice: 'Daniel',
    prepSec: 60,
    maxSec: 120,
    text: "Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish. Here is your topic.",
    card: [
      'Describe a time when you had to explain something difficult to someone.',
      'You should say:',
      '• who you were explaining it to',
      '• what you had to explain',
      '• why it was difficult',
      'and say how you felt about the result.',
    ],
  },
  { id: 'p3-1', type: 'part3', voice: 'Daniel', prepSec: 0, maxSec: 90, text: "We've been talking about explaining difficult things. Why do you think some people find it hard to explain complex ideas simply?" },
  { id: 'p3-2', type: 'part3', voice: 'Daniel', prepSec: 0, maxSec: 90, text: 'Do you think technology has made communication between people better or worse? Why?' },
  { id: 'p3-3', type: 'part3', voice: 'Daniel', prepSec: 0, maxSec: 90, text: 'Machine translation is getting better every year. Do you think people will still need to learn foreign languages in the future?' },
  { id: 'w-1', type: 'work', voice: 'Samantha', prepSec: 0, maxSec: 120, text: "Hi, thanks for joining the call today. To start, could you walk me through your background, and tell me what you're looking for in your next role?" },
  { id: 'w-2', type: 'work', voice: 'Karen', prepSec: 0, maxSec: 120, text: "I'm on the business side, so bear with me. You said your assistant sometimes refuses to answer. Why would we want a system that says it doesn't know? Isn't that a bad experience for our users?" },
  { id: 'w-3', type: 'work', voice: 'Rishi', prepSec: 0, maxSec: 120, text: "Let's imagine you've joined us. In your first week, a customer's engineering lead tells you they don't trust AI-generated code in their codebase. What would you do in your first two weeks with that customer?" },
  { id: 'w-4', type: 'work', voice: 'Samantha', prepSec: 0, maxSec: 120, text: "I'll be honest with you. Your proposal is about twice what we expected, and our internal team believes they could build this themselves in a month. Why should we work with you?" },
  {
    id: 'r-1',
    type: 'retell',
    voice: 'Karen',
    prepSec: 20,
    maxSec: 90,
    task: RETELL_TASK,
    text: "Hi, it's Megan from the operations team at Harbour Freight. Look, the pilot's going well overall, but a couple of things came up this week. First, the assistant gave one of our dispatchers an old version of the safety procedure, the one we replaced back in August, so we really need to understand how that happened. Second, our IT folks want the whole thing moved onto their own servers before Christmas, which I reckon might be a bit of a stretch. Could you give me a call back before Thursday? Cheers.",
  },
  {
    id: 'r-2',
    type: 'retell',
    voice: 'Rishi',
    prepSec: 20,
    maxSec: 90,
    task: RETELL_TASK,
    text: "Hello, this is Arjun from the data platform team. We tried connecting your tool to our staging database yesterday, but the connection kept timing out after about thirty seconds. Also, our security team says any new service has to go through a review, which usually takes two to three weeks, so we'd like to start that process now. Could you please send us the list of ports and the data your system needs to read, ideally by Monday? Thank you.",
  },
];

export const TYPE_LABELS: Record<SpeakingType, string> = {
  part1: 'Разминка',
  part2: 'Монолог по карточке',
  part3: 'Обсуждение',
  work: 'Рабочий сценарий',
  retell: 'Пересказ',
};

export const VOICE_LABELS: Record<Voice, string> = {
  Daniel: 'британский акцент',
  Samantha: 'американский акцент',
  Karen: 'австралийский акцент',
  Rishi: 'индийский акцент',
};

// Скорость речи голосов, слов в минуту: близко к разговорной, без поблажек и без гонки.
export const VOICE_RATE: Record<Voice, number> = { Daniel: 175, Samantha: 180, Karen: 180, Rishi: 170 };

export const audioUrl = (id: string) => `/audio/${id}.mp3`;
