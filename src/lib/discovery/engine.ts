import type {
  AggregatorSourceMeta,
  DiscoveredExam,
  DiscoveredQuestionRef,
  ExamStatus,
  VestibularDiscoveryIndex,
} from "./types";
import { generateExamFingerprint } from "./fingerprint";

/**
 * Third-party aggregators are discovery hints only. `priority` controls only
 * deterministic ordering among equally authoritative discovery hints; it is
 * never content authority. Following the canonical source policy, reuse is
 * permission-required unless explicit permission says otherwise.
 */
export const AGGREGATOR_SOURCES: AggregatorSourceMeta[] = [
  {
    id: "qconcursos",
    name: "QConcursos Vestibulares",
    baseUrl: "https://www.qconcursos.com",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 10,
  },
  {
    id: "kuadro",
    name: "Kuadro",
    baseUrl: "https://www.kuadro.com.br",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 9,
  },
  {
    id: "projeto-agatha",
    name: "Projeto Agatha Edu",
    baseUrl: "https://www.projetoagathaedu.com.br",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 8,
  },
  {
    id: "educabras",
    name: "EducaBras",
    baseUrl: "https://www.educabras.com",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 7,
  },
  {
    id: "etapa-resolve",
    name: "Etapa Resolve",
    baseUrl: "https://etapa.com.br/etaparesolve",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: false,
    priority: 8,
  },
  {
    id: "anglo-resolve",
    name: "Anglo Resolve",
    baseUrl: "https://www.curso-objetivo.br/vestibular/resolucao-comentada",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: false,
    priority: 8,
  },
  {
    id: "bernoulli-resolve",
    name: "Bernoulli Resolve",
    baseUrl: "https://www.bernoulli.com.br",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: false,
    priority: 8,
  },
  {
    id: "so-exercicios",
    name: "Só Exercícios",
    baseUrl: "https://www.soexercicios.com.br",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 6,
  },
  {
    id: "estuda",
    name: "Estuda.com",
    baseUrl: "https://vestibular.estuda.com",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 7,
  },
  {
    id: "brasil-escola",
    name: "Brasil Escola Vestibulares",
    baseUrl: "https://vestibular.brasilescola.uol.com.br",
    rightsStatus: "permission-required",
    supportsAnswers: true,
    supportsExams: true,
    supportsQuestions: true,
    priority: 7,
  },
];

export interface ConflictRecord {
  examId: string;
  institution: string;
  year: number;
  reason: string;
  resolved: boolean;
  chosenValue?: string;
}

const STATUS_PRECEDENCE: Record<ExamStatus, number> = {
  rectified: 4,
  final: 3,
  preliminary: 2,
  unknown: 1,
  annulled: 0,
};

function cloneQuestion(question: DiscoveredQuestionRef): DiscoveredQuestionRef {
  return {
    ...question,
    options: question.options?.map((option) => ({ ...option })),
  };
}

function cloneExam(exam: DiscoveredExam): DiscoveredExam {
  return {
    ...exam,
    corroboratedBy: exam.corroboratedBy ? [...exam.corroboratedBy] : undefined,
    questions: exam.questions?.map(cloneQuestion),
  };
}

export class DiscoveryEngine {
  private rawExams: DiscoveredExam[] = [];
  private conflicts: ConflictRecord[] = [];

  public registerExams(exams: DiscoveredExam[]): void {
    for (const exam of exams) {
      this.rawExams.push(cloneExam(exam));
    }
  }

  public buildIndex(): VestibularDiscoveryIndex {
    this.conflicts = [];

    const grouped = new Map<string, DiscoveredExam[]>();

    for (const exam of this.rawExams) {
      const fp = generateExamFingerprint(exam);
      const list = grouped.get(fp) ?? [];
      list.push(cloneExam(exam));
      grouped.set(fp, list);
    }

    const mergedExams: DiscoveredExam[] = [];

    for (const [fp, exams] of grouped.entries()) {
      const merged = this.resolveExamGroup(fp, exams);
      if (merged) mergedExams.push(merged);
    }

    const institutions = new Set(mergedExams.map((e) => e.institution));
    const totalQuestionsEstimated = mergedExams.reduce((sum, e) => sum + e.totalQuestions, 0);

    return {
      generatedAt: new Date().toISOString(),
      sources: AGGREGATOR_SOURCES,
      institutionsCount: institutions.size,
      examsCount: mergedExams.length,
      totalQuestionsEstimated,
      exams: mergedExams,
      conflicts: [...this.conflicts],
    };
  }

  private resolveExamGroup(fp: string, candidates: DiscoveredExam[]): DiscoveredExam | null {
    if (candidates.length === 1) return cloneExam(candidates[0]);

    // Discovery-only sources may suggest editions and corroborate identity, but
    // they are never allowed to override an official candidate. If at least
    // one official source exists, all semantic resolution happens only among
    // official candidates.
    const officialCandidates = candidates.filter((exam) => exam.sourceRole === "official");
    const authorityPool = officialCandidates.length > 0 ? officialCandidates : candidates;

    const highestStatus = Math.max(...authorityPool.map((exam) => STATUS_PRECEDENCE[exam.status]));
    const sameRevision = authorityPool.filter(
      (exam) => STATUS_PRECEDENCE[exam.status] === highestStatus,
    );

    // Status is authority inside the same source class: rectified > final >
    // preliminary. Aggregator priority is only a deterministic tie-breaker
    // after candidates have the same authority and agree semantically.
    const sourcePriorityMap = new Map(AGGREGATOR_SOURCES.map((source) => [source.id, source.priority]));
    const ordered = [...sameRevision].sort(
      (a, b) =>
        (sourcePriorityMap.get(b.aggregatorSourceId) ?? 0) -
        (sourcePriorityMap.get(a.aggregatorSourceId) ?? 0),
    );

    const base = cloneExam(ordered[0]);

    for (let index = 1; index < ordered.length; index++) {
      const other = ordered[index];

      if (base.totalQuestions !== other.totalQuestions) {
        this.addConflict(
          fp,
          base,
          `Total questions mismatch: ${base.aggregatorSourceId} (${base.totalQuestions}) vs ${other.aggregatorSourceId} (${other.totalQuestions})`,
        );
        return null;
      }

      if (!this.questionsAgree(fp, base, other)) return null;
    }

    base.corroboratedBy = [...new Set(candidates.map((exam) => exam.aggregatorSourceId))];
    return base;
  }

  private questionsAgree(fp: string, base: DiscoveredExam, other: DiscoveredExam): boolean {
    if (!base.questions || !other.questions) return true;

    const baseByNumber = new Map(base.questions.map((question) => [question.questionNumber, question]));
    const otherByNumber = new Map(other.questions.map((question) => [question.questionNumber, question]));

    if (baseByNumber.size !== base.questions.length || otherByNumber.size !== other.questions.length) {
      this.addConflict(fp, base, "Duplicate question number reported by a discovery source");
      return false;
    }

    if (baseByNumber.size !== otherByNumber.size) {
      this.addConflict(
        fp,
        base,
        `Question coverage mismatch: ${base.aggregatorSourceId} (${baseByNumber.size}) vs ${other.aggregatorSourceId} (${otherByNumber.size})`,
      );
      return false;
    }

    for (const [number, qBase] of baseByNumber.entries()) {
      const qOther = otherByNumber.get(number);
      if (!qOther) {
        this.addConflict(fp, base, `Question ${number} is missing from ${other.aggregatorSourceId}`);
        return false;
      }

      if (Boolean(qBase.isAnnulled) !== Boolean(qOther.isAnnulled)) {
        this.addConflict(
          fp,
          base,
          `Annulment conflict on Q${number}: ${base.aggregatorSourceId} (${Boolean(qBase.isAnnulled)}) vs ${other.aggregatorSourceId} (${Boolean(qOther.isAnnulled)})`,
        );
        return false;
      }

      if (
        qBase.correctAnswer &&
        qOther.correctAnswer &&
        qBase.correctAnswer !== qOther.correctAnswer
      ) {
        this.addConflict(
          fp,
          base,
          `Answer conflict on Q${number}: ${qBase.correctAnswer} vs ${qOther.correctAnswer}`,
        );
        return false;
      }
    }

    return true;
  }

  private addConflict(fp: string, exam: DiscoveredExam, reason: string): void {
    this.conflicts.push({
      examId: fp,
      institution: exam.institution,
      year: exam.year,
      reason,
      resolved: false,
    });
  }
}
