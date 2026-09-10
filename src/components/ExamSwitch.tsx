"use client";
import { useStore } from "@/lib/store";
import { listProviders, resolveProviderId } from "@/lib/providers";

/**
 * Prova ativa da interface. Fica no shell porque atravessa várias telas —
 * e o usuário precisa saber em qual prova está trabalhando sem procurar.
 */
export function useActiveProvider() {
  const id = useStore((s) => resolveProviderId(s.db.activeProvider));
  const setActiveProvider = useStore((s) => s.setActiveProvider);
  return { providerId: id, setProvider: setActiveProvider };
}

export default function ExamSwitch() {
  const { providerId, setProvider } = useActiveProvider();
  const provas = listProviders();

  // Com uma prova só, o seletor seria ruído.
  if (provas.length < 2) return null;

  return (
    <div className="examswitch" role="group" aria-label="Prova ativa">
      {provas.map((p) => (
        <button
          key={p.id}
          className={p.id === providerId ? "on" : ""}
          onClick={() => setProvider(p.id)}
          aria-pressed={p.id === providerId}
          title={p.metadata.label}
        >
          {p.metadata.shortLabel}
        </button>
      ))}
    </div>
  );
}
