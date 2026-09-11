from pathlib import Path

path = Path("scripts/sources-audit.mjs")
text = path.read_text(encoding="utf-8")
anchor = '''  {
    providerId: "ita",
    sourceId: "ita-official-archive",
'''
entry = '''  {
    providerId: "espcex",
    sourceId: "espcex-official-archive",
    archiveUrl: "https://espcex.eb.mil.br/",
    documentos: [
      {
        role: "objective-exam-day1",
        url: "https://espcex.eb.mil.br/images/concurso/provas/provas2025/2025%20PROVA%20MODELO%20A.pdf",
        informativo: true,
      },
      {
        role: "answer-key-day1",
        url: "https://espcex.eb.mil.br/images/concurso/2025_publConcurso/gabarito/gabarito_primeiro_dia_final.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day2",
        url: "https://espcex.eb.mil.br/images/concurso/provas/provas2025/2025%20PROVA%20MODELO%20D.pdf",
        informativo: true,
      },
      {
        role: "answer-key-day2",
        url: "https://espcex.eb.mil.br/images/concurso/2025_publConcurso/gabarito/gabarito_segundo_dia_final.pdf",
        informativo: true,
      },
    ],
  },
  {
    providerId: "ita",
    sourceId: "ita-official-archive",
'''
count = text.count(anchor)
if count != 1:
    raise RuntimeError(f"expected one ITA audit anchor, got {count}")
path.write_text(text.replace(anchor, entry, 1), encoding="utf-8")
