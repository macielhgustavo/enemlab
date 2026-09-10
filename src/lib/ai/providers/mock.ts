import { generatedQuestionIdentity } from "../pedagogy";
import type { AIProvider, AIProviderRequest, AIResponse } from "../types";

function selected(input: AIProviderRequest): string | null {
  return input.request.selectedAlternative || input.request.question.selectedAnswer || null;
}

export class MockAIProvider implements AIProvider {
  readonly id = "mock";

  async generate(input: AIProviderRequest): Promise<AIResponse> {
    const { request, policy } = input;
    const topic = request.question.topic || request.question.subject;
    const chosen = selected(input);
    const correct = request.question.correctAnswer || null;

    if (request.mode === "hint") {
      return {
        mode: request.mode,
        level: policy.level,
        title: "Pista 1 de 6",
        explanation: `Comece identificando qual ideia de ${topic} o enunciado está testando. Não tente escolher uma alternativa ainda.`,
        concepts: [topic, request.question.subject],
        nextStep:
          "Separe no enunciado o dado principal e a pergunta final. Depois elimine uma alternativa que contradiga diretamente esses dois pontos.",
        revealAnswer: false,
        provider: this.id,
      };
    }

    if (request.mode === "why-wrong") {
      const matchesKey = !!chosen && !!correct && chosen === correct;
      return {
        mode: request.mode,
        level: policy.level,
        title: chosen ? `Reavalie a alternativa ${chosen}` : "Reavalie sua escolha",
        explanation: !chosen
          ? "Marque uma alternativa primeiro para eu conseguir analisar especificamente sua escolha."
          : matchesKey
            ? `A alternativa ${chosen} coincide com o gabarito disponível. O próximo passo é justificar por que ela satisfaz a condição central usando ${topic}.`
            : `A alternativa ${chosen} não satisfaz completamente a condição central do enunciado. Verifique se ela realmente aplica ${topic}, e não apenas se parece plausível isoladamente.`,
        concepts: [topic],
        nextStep:
          "Volte ao trecho do enunciado que limita a resposta e teste sua alternativa contra essa condição, palavra por palavra.",
        revealAnswer: false,
        diagnostic: matchesKey
          ? undefined
          : {
              category: "unknown",
              confidence: "low",
              note: "O mock de desenvolvimento não classifica o tipo de erro sem inferência semântica.",
            },
        provider: this.id,
      };
    }

    if (request.mode === "guided-solve") {
      return {
        mode: request.mode,
        level: policy.level,
        title: "Vamos resolver juntos",
        explanation: `1. Identifique o que a questão pede. 2. Liste os dados úteis. 3. Relacione-os ao conceito de ${topic}. 4. Só então compare o resultado com as alternativas.`,
        concepts: [topic, request.question.subject],
        nextStep:
          "Diga qual dado ou frase do enunciado você considera mais importante; a próxima orientação parte da sua escolha.",
        revealAnswer: false,
        provider: this.id,
      };
    }

    if (request.mode === "explain-alternative") {
      const matchesKey = !!chosen && !!correct && chosen === correct;
      return {
        mode: request.mode,
        level: policy.level,
        title: chosen ? `Alternativa ${chosen}` : "Explique uma alternativa",
        explanation: !chosen
          ? "Selecione uma alternativa para analisá-la no contexto da questão."
          : matchesKey
            ? `A alternativa ${chosen} é compatível com o gabarito disponível. Para aprender com ela, identifique exatamente como sua afirmação aplica ${topic} ao comando da questão.`
            : `A alternativa ${chosen} precisa ser confrontada com ${topic} e com as restrições do enunciado. Uma alternativa pode conter um conceito verdadeiro e ainda assim não responder ao que foi perguntado.`,
        concepts: [topic],
        nextStep: "Compare o verbo do comando da questão com o que essa alternativa realmente afirma.",
        revealAnswer: false,
        provider: this.id,
      };
    }

    if (request.mode === "study-needed") {
      return {
        mode: request.mode,
        level: policy.level,
        title: "O que estudar antes",
        explanation: `Para ficar confortável com questões deste tipo, priorize ${topic} e revise os conceitos-base de ${request.question.subject} que levam até esse assunto.`,
        concepts: [topic, request.question.subject],
        nextStep: `Faça uma revisão curta de ${topic} e depois resolva 3 a 5 questões do mesmo assunto sem consultar a teoria.`,
        revealAnswer: false,
        provider: this.id,
      };
    }

    if (request.mode === "similar-question") {
      const identity = generatedQuestionIdentity(request.question);
      return {
        mode: request.mode,
        level: policy.level,
        title: "Prática semelhante",
        explanation: "Gerei uma questão de treino separada da questão oficial.",
        concepts: [topic],
        nextStep: "Resolva sem consultar a questão original e só depois compare os raciocínios.",
        revealAnswer: false,
        generatedQuestion: {
          origin: "ai-generated",
          label: identity.label,
          style: identity.style,
          statement: `Questão de treino sobre ${topic}: identifique a alternativa que melhor aplica o conceito central apresentado no enunciado original.`,
          alternatives: [
            { letter: "A", text: "Aplica o conceito sem considerar a condição central do problema." },
            { letter: "B", text: "Relaciona corretamente o conceito à condição central do problema." },
            { letter: "C", text: "Usa um conceito próximo, mas responde a outra pergunta." },
            { letter: "D", text: "Generaliza uma regra que não vale para o caso apresentado." },
            { letter: "E", text: "Desconsidera uma informação necessária para a conclusão." },
          ],
          correctAnswer: "B",
          explanation: "A alternativa B foi definida como correta apenas nesta questão simulada de desenvolvimento.",
        },
        provider: this.id,
      };
    }

    if (policy.revealAnswer && correct) {
      return {
        mode: request.mode,
        level: policy.level,
        title: "Solução completa",
        explanation: `O gabarito disponível no contexto da questão é ${correct}. Para chegar a ele, organize os dados do enunciado, aplique ${topic} e elimine as alternativas incompatíveis com a condição central.`,
        concepts: [topic, request.question.subject],
        nextStep: "Refaça a questão sem olhar a solução e explique em uma frase por que as demais alternativas não servem.",
        revealAnswer: true,
        answer: correct,
        provider: this.id,
      };
    }

    return {
      mode: request.mode,
      level: policy.level,
      title: request.mode === "explain" ? "Entenda a lógica da questão" : "Tutor ENEMLab",
      explanation: request.message
        ? `Sua pergunta foi: “${request.message}”. Use ${topic} como eixo da análise e conecte cada parte da resposta ao que o enunciado realmente pede.`
        : `Esta questão testa principalmente ${topic}. A melhor estratégia é identificar o comando, separar evidências do enunciado e só depois comparar as alternativas.`,
      concepts: [topic, request.question.subject],
      nextStep:
        "Tente explicar com suas palavras qual é a pergunta central. Se quiser, peça uma pista, resolução guiada ou solução completa.",
      revealAnswer: false,
      provider: this.id,
    };
  }
}
