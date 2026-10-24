// Corrections that teach Watson a spelling (owner, 24 Oct: "when I say my name … it's written as N-I-C-K
// … I am unable to correct it as we speak"). A changed word or name becomes "heard → written" for this
// patient; an added or removed word, or a sentence said differently, is an edit, not a spelling.
import { describe, expect, it } from "vitest";
import { spellingsFrom } from "./spelling";

describe("the spellings in a corrected line", () => {
  it("are the words that changed, as heard and as written", () => {
    expect(spellingsFrom("My name is Yana Novakova, I live in Bratislava.", "My name is Jana Nováková, I live in Bratislava."))
      .toEqual([{ heard: "Yana Novakova", written: "Jana Nováková" }]);
    expect(spellingsFrom("I take a sugar Gandhi in the evening.", "I take ashwagandha in the evening."))
      .toEqual([{ heard: "a sugar Gandhi", written: "ashwagandha" }]);
    expect(spellingsFrom("nick told me about abyanga", "Nik told me about abhyanga"))
      .toEqual([{ heard: "nick", written: "Nik" }, { heard: "abyanga", written: "abhyanga" }]);
  });

  it("leave out added or removed words, punctuation, and a sentence said differently", () => {
    expect(spellingsFrom("I wake at three", "I wake at three every night")).toEqual([]);
    expect(spellingsFrom("I wake at three every night", "I wake at three")).toEqual([]);
    expect(spellingsFrom("I wake at three.", "I wake at three!")).toEqual([]);
    expect(spellingsFrom("so the thing is that I cannot sleep well at all", "my sleep has been poor for a month now"))
      .toEqual([]);
    expect(spellingsFrom("same words", "same words")).toEqual([]);
  });
});
