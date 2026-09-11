import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
key = data.get("2023")
if not key:
    raise RuntimeError("EsPCEx 2023 missing")

key["revision"] = "final-2023-10-16"
day2 = key["days"]["day2"]
day2["annulled"] = [27]
day2["answers"].pop("27", None)
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(k23.revision).toBe("mirror-reviewed-2023");\n',
    '    expect(k23.revision).toBe("final-2023-10-16");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q24 = espcexQuestions(2024).find((q) => q.phase === "day2" && q.number === 42)!;
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q23 = espcexQuestions(2023).find((q) => q.phase === "day2" && q.number === 27)!;
    expect(q23.correctAlternative).toBeNull();
    expect(q23.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q24 = espcexQuestions(2024).find((q) => q.phase === "day2" && q.number === 42)!;
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "verificáveis são espelhos públicos, por isso essas questões e sua procedência carregam " +\n',
    '    "verificáveis são espelhos públicos; o gabarito final de 2023 é a revisão de 16/10, " +\n    "com a questão 27 do 2º dia anulada. Por isso essas questões e sua procedência carregam " +\n',
)
