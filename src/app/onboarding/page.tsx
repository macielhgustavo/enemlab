"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Clock3, GraduationCap, Target } from "lucide-react";
import { ADAPTIVE_OBJECTIVES } from "@/lib/domain/adaptive-objectives";
import {
  completeStudyOnboarding,
  skipStudyOnboarding,
  studyOnboardingDefaults,
} from "@/lib/domain/study-onboarding";
import type { StudyOnboardingDraft } from "@/lib/domain/study-onboarding";
import { listProviders } from "@/lib/providers";
import { useHydrated } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui";

const MINUTE_PRESETS = [30, 45, 60, 90, 120];

export default function OnboardingPage() {
  const db = useStore((state) => state.db);
  const mutate = useStore((state) => state.mutate);
  const hydrated = useHydrated();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [draftState, setDraftState] = useState<StudyOnboardingDraft | null>(null);

  if (!hydrated) {
    return (
      <div className="el-onboarding">
        <Card className="el-onboarding__card" aria-busy="true">
          <span className="muted">Preparando sua configuração…</span>
        </Card>
      </div>
    );
  }

  const draft = draftState ?? studyOnboardingDefaults(db, db.activeProvider ?? "enem");
  const { providerId, objective, targetDate, weeklyQuestions, dailyMinutes } = draft;
  const provider = listProviders().find((item) => item.id === providerId);
  const editing = Boolean(
    db.studyIntelligence?.providerConfig?.[providerId]?.onboardingCompletedAt,
  );

  function patchDraft(patch: Partial<StudyOnboardingDraft>) {
    setDraftState({ ...draft, ...patch });
  }

  function loadProvider(nextProviderId: string) {
    setDraftState(studyOnboardingDefaults(db, nextProviderId));
  }

  function finish() {
    mutate((current) => {
      completeStudyOnboarding(current, {
        providerId,
        objective,
        targetDate,
        weeklyQuestions,
        dailyMinutes,
      });
    });
    router.replace("/plano");
  }

  function skip() {
    mutate((current) => {
      current.activeProvider = providerId;
      skipStudyOnboarding(current, providerId);
    });
    router.replace("/");
  }

  return (
    <div className="el-onboarding">
      <header className="el-onboarding__header">
        <div>
          <span className="eyebrow">{editing ? "AJUSTAR ROTINA" : "PRIMEIRA CONFIGURAÇÃO"}</span>
          <h1>{editing ? "Ajuste como o plano deve trabalhar." : "Vamos montar seu contexto de estudo."}</h1>
          <p className="muted">
            Três passos. Tudo fica local e pode ser alterado depois sem apagar seu histórico.
          </p>
        </div>
        <div className="el-onboarding__progress" aria-label={`Etapa ${step} de 3`}>
          {[1, 2, 3].map((value) => (
            <span key={value} className={value <= step ? "active" : ""} />
          ))}
        </div>
      </header>

      <Card className="el-onboarding__card">
        {step === 1 && (
          <section aria-labelledby="onboarding-provider-title">
            <div className="el-onboarding__section-head">
              <GraduationCap aria-hidden="true" />
              <div>
                <span className="eyebrow">ETAPA 1 DE 3</span>
                <h2 id="onboarding-provider-title">Qual prova você está preparando?</h2>
                <p className="muted">Isso define a taxonomia, o banco e as métricas que aparecem primeiro.</p>
              </div>
            </div>
            <div className="el-onboarding__options">
              {listProviders().map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={providerId === item.id ? "active" : ""}
                  aria-pressed={providerId === item.id}
                  onClick={() => loadProvider(item.id)}
                >
                  <strong>{item.metadata.shortLabel}</strong>
                  <span>{item.metadata.label}</span>
                  {providerId === item.id ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="onboarding-goal-title">
            <div className="el-onboarding__section-head">
              <Target aria-hidden="true" />
              <div>
                <span className="eyebrow">ETAPA 2 DE 3</span>
                <h2 id="onboarding-goal-title">Qual é seu foco agora?</h2>
                <p className="muted">
                  O padrão balanceado funciona bem para começar. O motor pode ser ajustado depois.
                </p>
              </div>
            </div>
            <div className="el-onboarding__objectives" role="radiogroup" aria-label="Objetivo de estudo">
              {Object.values(ADAPTIVE_OBJECTIVES).map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={objective === item.id}
                  className={objective === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => patchDraft({ objective: item.id })}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
            <label className="el-onboarding__field" htmlFor="onboarding-target-date">
              <span><CalendarDays size={16} aria-hidden="true" /> Data da prova ou data-alvo</span>
              <input
                id="onboarding-target-date"
                type="date"
                value={targetDate}
                onChange={(event) => patchDraft({ targetDate: event.target.value })}
              />
              <small className="muted">Opcional. Você pode definir ou mudar isso depois.</small>
            </label>
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby="onboarding-routine-title">
            <div className="el-onboarding__section-head">
              <Clock3 aria-hidden="true" />
              <div>
                <span className="eyebrow">ETAPA 3 DE 3</span>
                <h2 id="onboarding-routine-title">Quanto cabe na sua rotina?</h2>
                <p className="muted">
                  O Plano usa esse tempo para não sugerir mais trabalho do que cabe no seu dia.
                </p>
              </div>
            </div>
            <div className="el-onboarding__minutes" role="group" aria-label="Minutos disponíveis por dia">
              {MINUTE_PRESETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={dailyMinutes === value ? "active" : ""}
                  aria-pressed={dailyMinutes === value}
                  onClick={() => patchDraft({ dailyMinutes: value })}
                >
                  {value} min
                </button>
              ))}
            </div>
            <label className="el-onboarding__field" htmlFor="onboarding-weekly-questions">
              <span>Meta semanal de questões</span>
              <input
                id="onboarding-weekly-questions"
                type="number"
                min={20}
                max={2000}
                step={10}
                value={weeklyQuestions}
                onChange={(event) => patchDraft({ weeklyQuestions: Number(event.target.value) })}
              />
              <small className="muted">
                {provider?.metadata.shortLabel ?? "Sua prova"} · {dailyMinutes} min disponíveis por dia.
              </small>
            </label>
          </section>
        )}

        <footer className="el-onboarding__actions">
          <Button variant="ghost" onClick={skip}>
            Pular por enquanto
          </Button>
          <div>
            {step > 1 ? (
              <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>
                Voltar
              </Button>
            ) : null}
            {step < 3 ? (
              <Button variant="primary" onClick={() => setStep((value) => value + 1)}>
                Continuar
              </Button>
            ) : (
              <Button variant="primary" onClick={finish}>
                Salvar e abrir plano
              </Button>
            )}
          </div>
        </footer>
      </Card>
    </div>
  );
}
