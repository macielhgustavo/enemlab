import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Dataset. Gabaritos finais apontam para a EsPCEx; os cadernos 2024 usados
# como referência visual são espelhos públicos e ficam explicitamente não-oficiais.
path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2024" in data:
    raise RuntimeError("EsPCEx 2024 already exists")
data["2024"] = {
    "year": 2024,
    "revision": "final-2024-10-21",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": "https://onlineespecifico.com.br/wp-content/uploads/2025/01/2024-Prova-EsPCEx-1-dia.pdf",
            "examOfficial": False,
            "answerKeyUrl": "https://espcex.eb.mil.br/images/concurso/2024_publConcurso/gabaritos/Gabarito_2024_Dia_1_Final.pdf",
            "verificationUrl": "https://onlineespecifico.com.br/wp-content/uploads/2025/01/2024-Gabarito-EsPCEx-1-dia.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"A","2":"D","3":"C","4":"D","5":"B","6":"C","7":"C","8":"E","9":"B","10":"E",
                "11":"D","12":"A","13":"C","14":"A","15":"D","16":"A","17":"E","18":"A","19":"B","20":"A",
                "21":"C","22":"E","23":"B","24":"E","25":"D","26":"C","27":"A","28":"A","29":"A","30":"D","31":"E","32":"D",
                "33":"E","34":"C","35":"D","36":"A","37":"C","38":"E","39":"B","40":"A","41":"C","42":"D","43":"D","44":"B",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": "https://onlineespecifico.com.br/wp-content/uploads/2025/01/2024-Prova-EsPCEx-2-dia.pdf",
            "examOfficial": False,
            "answerKeyUrl": "https://espcex.eb.mil.br/images/concurso/2024_publConcurso/gabaritos/Gabarito_2024_Dia_2_Final.pdf",
            "verificationUrl": "https://onlineespecifico.com.br/wp-content/uploads/2025/01/2024-Gabarito-EsPCEx-2-dia.pdf",
            "annulled": [42],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"B","2":"C","3":"A","4":"D","5":"B","6":"A","7":"E","8":"B","9":"E","10":"D",
                "11":"B","12":"B","13":"A","14":"C","15":"B","16":"E","17":"A","18":"C","19":"D","20":"D",
                "21":"C","22":"D","23":"D","24":"B","25":"A","26":"E","27":"B","28":"D","29":"D","30":"A","31":"E","32":"B",
                "33":"A","34":"B","35":"B","36":"C","37":"E","38":"C","39":"D","40":"E","41":"E","43":"A","44":"C",
                "45":"C","46":"D","47":"A","48":"B","49":"D","50":"C","51":"A","52":"C","53":"E","54":"D","55":"E","56":"B",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Provider: distinguish institution-owned caderno from mirror caderno.
replace_once(
    "src/lib/providers/espcex/index.ts",
    "  examUrl: string;\n  answerKeyUrl: string;\n",
    "  examUrl: string;\n  examOfficial?: boolean;\n  answerKeyUrl: string;\n",
)
replace_once(
    "src/lib/providers/espcex/index.ts",
    '''      official: {
        official: true,
        institution: "EsPCEx",
        documentUrl: day.examUrl,
      },
''',
    '''      official: {
        official: day.examOfficial ?? true,
        institution: "EsPCEx",
        documentUrl: day.examUrl,
      },
''',
)

# Replace focused provider tests with multi-year + coverage invariants.
Path("src/lib/providers/espcex/espcex.test.ts").write_text('''import { describe, expect, it } from "vitest";
import {
  espcexAnswerKey,
  espcexExamUrl,
  espcexProvider,
  espcexQuestionKey,
  espcexQuestions,
  espcexYears,
} from ".";

describe("EsPCEx", () => {
  it("publica apenas edições completas e revisadas", () => {
    expect(espcexYears()).toEqual([2025, 2024]);
    const k24 = espcexAnswerKey(2024)!;
    expect(k24.revision).toBe("final-2024-10-21");
    expect(k24.days.day1.model).toBe("A");
    expect(k24.days.day2.model).toBe("D");
    expect(k24.days.day1.total).toBe(44);
    expect(k24.days.day2.total).toBe(56);
    expect(k24.days.day2.annulled).toEqual([42]);

    const k25 = espcexAnswerKey(2025)!;
    expect(k25.revision).toBe("final-2025-10-13");
    expect(k25.days.day1.total).toBe(44);
    expect(k25.days.day2.total).toBe(56);
  });

  it("cada dia cobre exatamente a numeração declarada", () => {
    for (const year of espcexYears()) {
      const key = espcexAnswerKey(year)!;
      for (const day of [key.days.day1, key.days.day2]) {
        const covered = [...Object.keys(day.answers).map(Number), ...day.annulled].sort((a, b) => a - b);
        expect(covered).toEqual(Array.from({ length: day.total }, (_, i) => i + 1));
        expect(new Set(covered).size).toBe(day.total);
        expect(Object.values(day.answers).every((answer) => /^[A-E]$/.test(answer))).toBe(true);
      }
    }
  });

  it("gera os dois dias sem misturar numeração", () => {
    for (const year of espcexYears()) {
      const questions = espcexQuestions(year);
      expect(questions).toHaveLength(100);
      expect(questions.filter((q) => q.phase === "day1")).toHaveLength(44);
      expect(questions.filter((q) => q.phase === "day2")).toHaveLength(56);
      expect(questions.find((q) => q.phase === "day1" && q.number === 44)?.subject.id).toBe("chemistry");
      expect(questions.find((q) => q.phase === "day2" && q.number === 45)?.subject.id).toBe("english");
    }
  });

  it("preserva anuladas sem marcar alternativa correta", () => {
    const q24 = espcexQuestions(2024).find((q) => q.phase === "day2" && q.number === 42)!;
    expect(q24.correctAlternative).toBeNull();
    expect(q24.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q25 = espcexQuestions(2025).find((q) => q.phase === "day1" && q.number === 2)!;
    expect(q25.correctAlternative).toBeNull();
  });

  it("não chama caderno espelhado de oficial", () => {
    const q24 = espcexQuestions(2024)[0];
    expect(q24.statementAvailable).toBe(false);
    expect(q24.official?.official).toBe(false);
    expect(q24.official?.documentUrl).toBe(espcexExamUrl(2024, "day1"));
    expect(q24.official?.documentUrl).toContain("onlineespecifico.com.br");

    const q25 = espcexQuestions(2025)[0];
    expect(q25.official?.official).toBe(true);
    expect(q25.official?.documentUrl).toContain("espcex.eb.mil.br");
  });

  it("usa chave estável por ano, dia e número", () => {
    expect(espcexQuestionKey(espcexQuestions(2025)[0])).toBe("espcex-2025-day1-1");
    expect(espcexQuestionKey(espcexQuestions(2024)[0])).toBe("espcex-2024-day1-1");
  });

  it("provider entrega as edições completas e recusa ano ausente", async () => {
    expect(await espcexProvider.fetchQuestions({ year: 2025 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2024 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toEqual([]);
  });
});
''', encoding="utf-8")

# Source registry and docs.
replace_once(
    "src/lib/sources/index.ts",
    '''  notes:
    "Entra 2025 completo: 44 questões objetivas no 1º dia e 56 no 2º. " +
    "Os cadernos e gabaritos finais têm URLs oficiais da EsPCEx; o servidor oficial " +
    "rejeita clientes automatizados neste ambiente, então a transcrição do gabarito " +
    "foi conferida também contra uma cópia pública datada de 13/10/2025. " +
    "O enunciado não é redistribuído pelo app: permanece no documento oficial.",
''',
    '''  notes:
    "Entram 2024–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +
    "Os gabaritos finais apontam para URLs da EsPCEx. Em 2025 os cadernos também têm " +
    "URL oficial; em 2024 os cadernos verificáveis usados pelo app são espelhos públicos " +
    "e por isso as questões desse ano carregam `official: false`. O app não redistribui PDFs.",
''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "      years: [2025],\n",
    "      years: [2025, 2024],\n",
)

# Source audit: official final-key URLs are informational because the EsPCEx
# server blocks/errs for automated clients; mirror cadernos are the live references.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2",
        url: "https://espcex.eb.mil.br/images/concurso/2025_publConcurso/gabarito/gabarito_segundo_dia_final.pdf",
        informativo: true,
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2",
        url: "https://espcex.eb.mil.br/images/concurso/2025_publConcurso/gabarito/gabarito_segundo_dia_final.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://onlineespecifico.com.br/wp-content/uploads/2025/01/2024-Prova-EsPCEx-1-dia.pdf",
      },
      {
        role: "answer-key-day1",
        url: "https://espcex.eb.mil.br/images/concurso/2024_publConcurso/gabaritos/Gabarito_2024_Dia_1_Final.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://onlineespecifico.com.br/wp-content/uploads/2025/01/2024-Prova-EsPCEx-2-dia.pdf",
      },
      {
        role: "answer-key-day2",
        url: "https://espcex.eb.mil.br/images/concurso/2024_publConcurso/gabaritos/Gabarito_2024_Dia_2_Final.pdf",
        informativo: true,
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2025 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` | `pdf-reference` | na fonte oficial | 2025 (2 dias) |",
    "| EsPCEx | gabaritos `espcex.eb.mil.br`; caderno 2024 via espelho público | `pdf-reference` | referência externa quando espelhado | 2024–2025 (2 dias) |",
)
