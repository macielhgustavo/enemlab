"use client";
import { Check, ChevronsUpDown } from "lucide-react";
import { listProviders } from "@/lib/providers";
import { useActiveProvider } from "@/components/ExamSwitch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/cn";

/**
 * Descrição curta de uma prova, feita só do que o provider realmente
 * declara. Nada de "em breve" nem contagem inventada: se um dia houver
 * FUVEST, ela aparece porque foi registrada, não porque foi prometida aqui.
 */
function resumo(years: number[], isActive: boolean): string {
  if (isActive) return "Prova ativa";
  if (years.length === 0) return "Sem edições ingeridas";
  if (years.length === 1) return "1 edição disponível";
  return `${years.length} edições disponíveis`;
}

/**
 * Seletor de prova ativa.
 *
 * O anterior era um par de botões com a sigla e nada mais — dava para trocar
 * de prova sem perceber o que tinha mudado. Este mostra o nome por extenso e
 * quantas edições existem, e o menu é do Radix, então setas, Home/End, Esc e
 * foco de retorno vêm prontos.
 */
export default function ProviderSwitcher({ className }: { className?: string }) {
  const { providerId, setProvider } = useActiveProvider();
  const provas = listProviders();

  // Com uma prova só, um seletor é ruído.
  if (provas.length < 2) return null;

  const ativa = provas.find((p) => p.id === providerId) ?? provas[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn("el-provider__trigger", className)}
        aria-label={`Prova ativa: ${ativa.metadata.label}. Trocar de prova`}
      >
        <span className="el-provider__badge" aria-hidden="true">
          {ativa.metadata.shortLabel.slice(0, 2)}
        </span>
        <span className="el-provider__text">
          <span className="el-provider__name">{ativa.metadata.shortLabel}</span>
          <span className="el-provider__meta">{resumo(ativa.metadata.years, true)}</span>
        </span>
        <ChevronsUpDown size={14} className="el-provider__chev" aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="el-provider__menu">
        <DropdownMenuLabel>Prova</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={providerId} onValueChange={setProvider}>
          {provas.map((p) => {
            const on = p.id === providerId;
            return (
              <M.RadioItem key={p.id} value={p.id} className="el-provider__option">
                <span className="el-provider__badge" aria-hidden="true">
                  {p.metadata.shortLabel.slice(0, 2)}
                </span>
                <span className="el-provider__text">
                  <span className="el-provider__name">{p.metadata.shortLabel}</span>
                  <span className="el-provider__meta">{resumo(p.metadata.years, on)}</span>
                </span>
                {on && <Check size={15} className="el-provider__check" aria-hidden="true" />}
              </M.RadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
