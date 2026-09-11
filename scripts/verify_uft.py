import argparse
import hashlib
import json
import re
from pathlib import Path


def parse_afternoon(title, table):
    if "VESTIBULAR UFT 2025.1" not in title or "GABARITO DEFINITIVO" not in title:
        raise ValueError("Documento não é o gabarito definitivo UFT 2025.1")
    if "PROVIS" in title.upper() or "PRELIMINAR" in title.upper():
        raise ValueError("Gabarito preliminar recusado")
    if len(table) != 10:
        raise ValueError("Estrutura da tabela da tarde alterada")
    answers, annulled, seen = {}, [], set()
    for numbers, values in zip(table[::2], table[1::2]):
        if len(numbers) != 10 or len(values) != 10:
            raise ValueError("Colunas inesperadas")
        for number, value in zip(numbers, values):
            if number is None and value is None:
                continue
            if not number or not re.fullmatch(r"[0-9]{2}", number):
                raise ValueError("Numeração inválida")
            index = int(number)
            if index in seen:
                raise ValueError("Numeração duplicada")
            seen.add(index)
            if value == "ANULADA":
                annulled.append(index)
            elif value in ("A", "B", "C", "D"):
                answers[str(index)] = value
            else:
                raise ValueError("Resposta inválida")
    if seen != set(range(1, 45)):
        raise ValueError("Questões faltantes ou excedentes")
    return answers, annulled


def verify(exam_path, key_path):
    import pdfplumber

    root = Path(__file__).resolve().parents[1]
    record = json.loads((root / "src/lib/providers/uft/answer-keys.generated.json").read_text(encoding="utf-8"))["2025-1"]
    native = json.loads((root / "data/native/uft-2025-1.json").read_text(encoding="utf-8"))
    key_bytes = key_path.read_bytes()
    if hashlib.sha256(key_bytes).hexdigest() != record["retrieval"]["sha256"]:
        raise ValueError("Gabarito alterado: revisar antes de importar")
    if len(key_bytes) != record["retrieval"]["bytes"]:
        raise ValueError("Tamanho do gabarito divergente")
    exam_hash = hashlib.sha256(exam_path.read_bytes()).hexdigest()
    if any(question["provenance"]["documentSha256"] != exam_hash for question in native["questions"]):
        raise ValueError("Prova alterada: transcrições precisam de revisão")
    with pdfplumber.open(key_path) as document:
        if len(document.pages) != 1:
            raise ValueError("Paginação do gabarito alterada")
        page = document.pages[0]
        labels = page.search("PROVA TARDE")
        if len(labels) != 1:
            raise ValueError("Turno ambíguo")
        tables = page.crop((0, labels[0]["bottom"], page.width, page.height)).extract_tables()
        if len(tables) != 1:
            raise ValueError("Tabela da tarde ambígua")
        answers, annulled = parse_afternoon(page.extract_text(), tables[0])
    if answers != record["answers"] or annulled != record["annulled"]:
        raise ValueError("Gabarito publicado não corresponde ao PDF")
    print(json.dumps({"status": "verified", "provider": "uft", "edition": "2025-1",
                      "phase": "afternoon", "questions": 44, "annulled": annulled,
                      "native": len(native["questions"])}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verifica os PDFs locais do piloto UFT; sem rede e sem publicar.")
    parser.add_argument("--exam", type=Path, required=True)
    parser.add_argument("--answer-key", type=Path, required=True)
    arguments = parser.parse_args()
    verify(arguments.exam, arguments.answer_key)
