"""Fills a practitioner's form from a transcript with a local model (decision 0005).

The model sees the transcript as numbered lines, and any documents the patient sent as lines
numbered D1, D2 and so on. For every field it first names the lines its answer rests on, then
writes the answer. Nothing leaves the computer."""

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

# "manual": the practitioner's alone, such as private notes; never asked of the model.
Mode = Literal["extract", "suggest", "manual"]
# Small models sometimes answer "none specified" instead of leaving a field empty.
# A bare "None" stays: the patient may have said so ("no operations").
EMPTY = re.compile(
    r"^((none|nothing|not) (specified|mentioned|discussed|stated|given)|n/?a|-"
    r"|neuveden[éa]|nešpecifikovan[éa]|nie je uveden[éa]"
    r"|nicht (erwähnt|angegeben)|keine angabe)\W*$",
    re.IGNORECASE,
)
LANGUAGE_NAMES = {"en": "English", "de": "German", "sk": "Slovak"}
# How much of the patient's documents a form reads, newest first: about 4,000 tokens.
DOCUMENT_CHARACTERS = 12000


class TemplateField(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    label: str = Field(min_length=1, max_length=120)
    mode: Mode = "extract"
    hint: str = Field(default="", max_length=300)


class TemplateSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    fields: list[TemplateField] = Field(min_length=1)


class Template(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    sections: list[TemplateSection] = Field(min_length=1)

    @property
    def fields(self) -> list[TemplateField]:
        return [f for s in self.sections for f in s.fields]

    @property
    def asked(self) -> list[TemplateSection]:
        """The sections and fields the model fills in: all but the practitioner's own."""
        return [
            TemplateSection(title=s.title, fields=kept)
            for s in self.sections
            if (kept := [f for f in s.fields if f.mode != "manual"])
        ]


@dataclass(frozen=True)
class Line:
    position: int
    speaker: Literal["practitioner", "patient"]
    text: str


@dataclass(frozen=True)
class DocumentLine:
    number: int  # shown to the model as D<number>
    document_id: str
    file_name: str
    page: int
    text: str


@dataclass(frozen=True)
class Quote:
    document_id: str
    page: int
    text: str


@dataclass(frozen=True)
class Answer:
    key: str
    text: str | None  # None: not discussed
    evidence: list[int]  # transcript positions the answer rests on
    quotes: list[Quote] = field(default_factory=list)  # document lines it rests on


class Model(Protocol):
    def complete(
        self, system: str, user: str, schema: dict[str, Any], stop: Callable[[], bool]
    ) -> str: ...


SYSTEM = """You fill in a practitioner's consultation form from the transcript of a consultation \
between a practitioner and a patient.

Rules:
- Use only what was said in the transcript. Never add facts, advice or diagnoses that nobody said.
- For every field, first list the numbers of the transcript lines the answer comes from, then \
write the answer.
- If nothing was said about a field's topic, give no lines and the answer null. Never write \
"none", "not mentioned" or "not specified".
- Put each fact or piece of advice in the one field it fits best; do not repeat it elsewhere.
- Fields about advice or recommendations hold only what the practitioner advised, not what \
the patient said.
- Write short notes, as a practitioner would, in {language}. Keep numbers, doses and the names \
of remedies exactly as they were said.
- Report the patient's own situation. A relative's illness is not the patient's condition.
- Fields marked SUGGEST ask for an assessment: give the practitioner's assessment if they said \
one, otherwise your suggestion from what the patient described, and cite the lines it rests on."""

# Added only when the patient sent documents, so a form without them is filled exactly as before.
DOCUMENT_RULES = """
- The patient also sent documents, shown as lines numbered D1, D2 and so on. Use them as \
well, and list the D numbers an answer comes from under "documents", without the D.
- A document is not something said in the consultation. Write what it states and where it \
comes from, for example "Ferritin 9 µg/L, low (blood test of 3 Oct)"."""


def document_lines(documents: list[dict[str, Any]]) -> list[DocumentLine]:
    """The patient's documents, newest first, as numbered lines, up to DOCUMENT_CHARACTERS."""
    lines: list[DocumentLine] = []
    used = 0
    for document in documents:
        for page, text in enumerate(document.get("pages") or [], start=1):
            for raw in str(text).splitlines():
                line = " ".join(raw.split())[:400]
                if len(line) < 2:
                    continue
                if used + len(line) > DOCUMENT_CHARACTERS:
                    return lines
                used += len(line)
                lines.append(
                    DocumentLine(
                        len(lines) + 1,
                        str(document["document_id"]),
                        str(document.get("file_name") or "Document"),
                        page,
                        line,
                    )
                )
    return lines


def numbered(lines: list[Line]) -> str:
    return "\n".join(
        f"[{line.position}] {line.speaker.capitalize()}: {line.text.strip()}" for line in lines
    )


def prompt(
    template: Template,
    lines: list[Line],
    language: str,
    documents: list[DocumentLine] | None = None,
) -> tuple[str, str]:
    fields = "\n".join(
        f"{section.title}:\n"
        + "\n".join(
            f"- {f.key}: {f.label}{'. ' + f.hint if f.hint else ''}"
            + (" [SUGGEST]" if f.mode == "suggest" else "")
            for f in section.fields
        )
        for section in template.asked
    )
    system = SYSTEM.format(language=LANGUAGE_NAMES.get(language, "the language of the transcript"))
    user = f"Form fields:\n{fields}\n\nTranscript:\n{numbered(lines)}"
    if documents:
        system += DOCUMENT_RULES
        user += "\n\nDocuments the patient sent:\n" + "\n".join(
            f"[D{d.number}] {d.file_name}, page {d.page}: {d.text}" for d in documents
        )
    return system, user


def schema(template: Template, with_documents: bool = False) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "lines": {"type": "array", "items": {"type": "integer"}, "maxItems": 12}
    }
    if with_documents:
        properties["documents"] = {"type": "array", "items": {"type": "integer"}, "maxItems": 6}
    properties["answer"] = {"type": ["string", "null"]}
    entry = {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }
    keys = [f.key for section in template.asked for f in section.fields]
    return {
        "type": "object",
        "properties": dict.fromkeys(keys, entry),
        "required": keys,
        "additionalProperties": False,
    }


def parse(
    raw: str, template: Template, lines: list[Line], documents: list[DocumentLine] | None = None
) -> list[Answer]:
    """Keeps only what the form asked for. Line numbers that do not exist are dropped."""
    data = json.loads(raw)
    known = {line.position for line in lines}
    by_number = {d.number: d for d in documents or []}
    answers = []
    for f in template.fields:
        if f.mode == "manual":
            answers.append(Answer(f.key, None, [], []))
            continue
        item = data.get(f.key) if isinstance(data, dict) else None
        item = item if isinstance(item, dict) else {}
        text = item.get("answer")
        text = text.strip()[:2000] if isinstance(text, str) and text.strip() else None
        text = None if text and EMPTY.match(text) else text
        cited = item.get("lines")
        cited = cited if isinstance(cited, list) else []
        evidence = sorted({n for n in cited if isinstance(n, int) and n in known})
        named = item.get("documents")
        named = named if isinstance(named, list) and text else []
        quotes = [
            Quote(by_number[n].document_id, by_number[n].page, by_number[n].text)
            for n in dict.fromkeys(named)
            if isinstance(n, int) and n in by_number
        ][:6]
        answers.append(Answer(f.key, text, evidence if text else [], quotes))
    return answers


def fill(
    model: Model,
    template: Template,
    lines: list[Line],
    language: str,
    stop: Callable[[], bool] = lambda: False,
    documents: list[DocumentLine] | None = None,
) -> list[Answer]:
    system, user = prompt(template, lines, language, documents)
    raw = model.complete(system, user, schema(template, bool(documents)), stop)
    return parse(raw, template, lines, documents)


class Cancelled(Exception):
    """The caller asked to stop while the model was still writing."""


class LlamaModel:
    """A GGUF model run in this process by llama.cpp, with output held to the JSON schema."""

    def __init__(self, path: Path, context: int = 16384, threads: int = 0) -> None:
        from llama_cpp import Llama

        self.path = path
        self.llm = Llama(
            model_path=str(path),
            n_ctx=context,
            n_threads=threads or None,
            verbose=False,
        )

    def complete(
        self, system: str, user: str, schema: dict[str, Any], stop: Callable[[], bool]
    ) -> str:
        started = time.monotonic()
        chunks: list[str] = []
        self.last_usage: dict[str, int] = {
            "prompt_tokens": len(self.llm.tokenize((system + user).encode()))
        }
        stream: Any = self.llm.create_chat_completion(
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object", "schema": schema},
            temperature=0.1,
            max_tokens=3000,
            stream=True,
        )
        for chunk in stream:  # one token at a time, so a cancelled job stops within a second
            if stop():
                raise Cancelled
            chunks.append(chunk["choices"][0]["delta"].get("content") or "")
        self.last_usage["completion_tokens"] = len(chunks)
        self.last_seconds = round(time.monotonic() - started, 2)
        return "".join(chunks)
