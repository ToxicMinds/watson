// What a correction teaches Watson: the words that changed, as heard and as written (owner, 24 Oct).
// Only a few words replaced by a few others count; an added or removed word, or a sentence said
// differently, is an edit, not a spelling. The database checks each pair again.
export type Spelling = { heard: string; written: string };

const MOST_WORDS = 4;
const MOST_LETTERS = 80;
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const words = (text: string) => text.split(/\s+/).map(bare).filter(Boolean);

export function spellingsFrom(before: string, after: string): Spelling[] {
  const a = words(before);
  const b = words(after);
  // Longest common run of words, so what stayed the same lines up and what changed stands out.
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const found: Spelling[] = [];
  let heard: string[] = [];
  let written: string[] = [];
  const close = () => {
    const pair = { heard: heard.join(" "), written: written.join(" ") };
    if (heard.length && written.length && heard.length <= MOST_WORDS && written.length <= MOST_WORDS
      && pair.heard.length <= MOST_LETTERS && pair.written.length <= MOST_LETTERS) found.push(pair);
    heard = [];
    written = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || common[i][j + 1] >= common[i + 1][j])) {
      written.push(b[j++]);
    } else {
      heard.push(a[i++]);
    }
  }
  close();
  return found;
}
