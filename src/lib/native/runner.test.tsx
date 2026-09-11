import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExamPage from "../../app/exam/[id]/page";
import { useStore } from "../store";
import { buildItaFirstPhaseAttempt } from "../services/ita-attempts";
import { itaFirstPhaseQuestions } from "../providers/ita";
import { withStructuredQuestionContent } from "../providers/structuredRegistry";
import { toLegacyQuestion } from "../providers/legacy";
import type { Question } from "../domain/types";

const query = vi.hoisted(() => ({ data: [] as Question[] }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: query.data, isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "native-runner-test" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../hooks", () => ({ useHydrated: () => true }));

afterEach(cleanup);

it("renders and answers native content in the real runner without the PDF panel", () => {
  const base = itaFirstPhaseQuestions(2025)[0];
  query.data = [
    toLegacyQuestion(
      withStructuredQuestionContent(
        base,
        {
          providerId: base.providerId,
          year: base.year,
          number: base.number!,
          phase: base.phase,
          statement: "Enunciado sintético visível no resolvedor",
          context: "Texto de apoio sintético",
          alternativesIntroduction: "Escolha a alternativa de teste:",
          alternatives: base.alternatives.map((alternative) => ({
            letter: alternative.letter,
            text: `Resposta de teste ${alternative.letter}`,
          })),
          files: ["/native/assets/test-diagram.svg"],
          validationLevel: "reviewed",
          provenance: {
            documentUrl: base.official!.documentUrl,
            documentSha256: "a".repeat(64),
            parserVersion: "test-only@1",
            extractionMethod: "manual",
            rightsStatus: "allowed",
            reviewedAt: "2026-09-10T12:00:00Z",
          },
        },
        "ITA",
      ),
    ),
  ];
  const attempt = buildItaFirstPhaseAttempt(2025);
  attempt.id = "native-runner-test";
  attempt.questionRefs = attempt.questionRefs.slice(0, 1);
  useStore.setState((state) => ({ db: { ...state.db, attempts: [attempt] } }));
  const { container } = render(<ExamPage />);
  expect(screen.getByText(/Enunciado sintético visível/)).toBeVisible();
  expect(screen.getByText(/Texto de apoio sintético/)).toBeVisible();
  expect(screen.getByText("Escolha a alternativa de teste:")).toBeVisible();
  expect(
    container.querySelector('img[src="/native/assets/test-diagram.svg"]'),
  ).toBeInTheDocument();
  expect(screen.queryByText("Enunciado na prova oficial")).not.toBeInTheDocument();
  expect(container.querySelector("iframe")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Resposta de teste A"));
  expect(container.querySelector(".answer.selected")).toHaveTextContent("Resposta de teste A");
});
