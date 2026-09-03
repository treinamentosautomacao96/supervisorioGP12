// ============================================================================
//  ABAS e os DOIS MODOS DE TRABALHO
//
//  Três telas — o processo e um acionamento em cada — e duas maneiras de
//  andar entre elas.
//
//  APRESENTAÇÃO. A tela troca sozinha, de tempos em tempos. É o modo do
//  monitor pendurado na célula, que ninguém opera: sem rodízio, esse monitor
//  mostraria para sempre a mesma aba, e as outras duas existiriam só para
//  quem soubesse que existem.
//
//  MANUAL. Ninguém troca nada além de quem clicar. É o modo de quem está
//  DIAGNOSTICANDO: acompanhar a corrente de um inversor por três minutos é
//  impossível se a tela fugir a cada quinze segundos. O rodízio, que é útil
//  no monitor, vira sabotagem na investigação.
//
//  A escolha sobrevive à recarga da página — inclusive à recarga automática
//  do `useAutoReload`, que acontece sem ninguém por perto. O monitor da
//  célula precisa voltar sozinho para o modo em que estava.
//
//  ------------------------------------------------------ ABAS QUE SOMEM ----
//  O rodízio só passa por abas com DADO. Enquanto as chamadas do bloco 09 não
//  estiverem no Main do CLP, os dois inversores são `null`, e um rodízio
//  ingênuo pararia trinta segundos em duas telas vazias a cada volta — a
//  maior parte do tempo mostrando nada. Sem dado, a aba continua clicável (é
//  onde se lê "aguardando o CLP") mas fica fora do rodízio.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";

export type Aba = "processo" | "entrada" | "balanca";
export type Modo = "apresentacao" | "manual";

/** Quanto tempo cada aba fica no ar em modo apresentação. Quinze segundos é
 *  o suficiente para ler a tela inteira sem virar espera. */
export const PERIODO_S = 15;

const CHAVE_MODO = "supervisorio.modo";

export interface Abas {
  aba: Aba;
  modo: Modo;
  /** Muda a cada troca automática: serve de `key` para reiniciar a animação
   *  da barra de progresso sem um cronômetro em JavaScript. */
  ciclo: number;
  ir: (a: Aba) => void;
  setModo: (m: Modo) => void;
}

export function useAbas(comDado: Aba[]): Abas {
  const [aba, setAba] = useState<Aba>("processo");
  const [modo, setModoBruto] = useState<Modo>(() => {
    try {
      return sessionStorage.getItem(CHAVE_MODO) === "apresentacao"
        ? "apresentacao"
        : "manual";
    } catch { return "manual"; }
  });
  const [ciclo, setCiclo] = useState(0);

  // A lista viva numa ref: se entrasse nas dependências do efeito, o
  // cronômetro do rodízio seria recriado toda vez que um inversor aparecesse
  // ou sumisse, e a aba da vez perderia o tempo já corrido.
  const disponiveis = useRef(comDado);
  disponiveis.current = comDado;

  const setModo = useCallback((m: Modo) => {
    setModoBruto(m);
    try { sessionStorage.setItem(CHAVE_MODO, m); } catch { /* modo privado */ }
  }, []);

  const ir = useCallback((a: Aba) => {
    setAba(a);
    // Clicar em apresentação NÃO desliga o rodízio — só devolve o tempo
    // cheio à aba escolhida. Quem quer parar de vez tem o botão do modo, e
    // desligar por clique faria o rodízio morrer por acidente, sem aviso.
    setCiclo((n) => n + 1);
  }, []);

  useEffect(() => {
    if (modo !== "apresentacao") return;
    const t = setInterval(() => {
      setAba((atual) => {
        const lista = disponiveis.current;
        if (lista.length < 2) return atual;
        const i = lista.indexOf(atual);
        // Aba fora da lista (ficou sem dado enquanto estava no ar): o rodízio
        // recomeça pela primeira em vez de travar num índice -1.
        return lista[(i + 1) % lista.length] ?? lista[0];
      });
      setCiclo((n) => n + 1);
    }, PERIODO_S * 1000);
    return () => clearInterval(t);
    // `ciclo` nas dependências REINICIA o cronômetro a cada troca, inclusive
    // as manuais. Sem isso o `setInterval` seguiria o próprio calendário: um
    // clique aos 14 s daria um segundo de tela à aba escolhida, enquanto a
    // barra — que reinicia pelo `ciclo` — prometia quinze. Barra e relógio
    // têm de ser a mesma coisa, ou a barra não é informação.
  }, [modo, ciclo]);

  return { aba, modo, ciclo, ir, setModo };
}
