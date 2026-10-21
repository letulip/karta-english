// Разбор текста заданий части 4 на куски для показа.

export interface Piece {
  text: string;
  seg?: number; // номер выделенного фрагмента в задании «найди ошибку»
}

// «She [has worked] here [since] …» → обычный текст и кликабельные фрагменты с номерами 0–3.
export function parseErrorSentence(sentence: string): Piece[] {
  const pieces: Piece[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let seg = 0;
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
    if (m.index > last) pieces.push({ text: sentence.slice(last, m.index) });
    pieces.push({ text: m[1] ?? '', seg: seg++ });
    last = m.index + m[0].length;
  }
  if (last < sentence.length) pieces.push({ text: sentence.slice(last) });
  return pieces;
}

// Текст до и после пропуска «___».
export function splitBlank(prompt: string): [string, string] {
  const i = prompt.indexOf('___');
  return i < 0 ? [prompt, ''] : [prompt.slice(0, i), prompt.slice(i + 3)];
}
