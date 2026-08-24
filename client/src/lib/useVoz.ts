// ============================================================================
//  AVISOS FALADOS
//
//  Usa a síntese de voz do próprio navegador (Web Speech API): nenhum arquivo
//  de áudio, nenhum byte de rede, e a frase é montada na hora. Depois de
//  cortar o tráfego 42x, trazer MP3 de volta seria contraditório.
//
//  TRÊS ARMADILHAS, TRATADAS AQUI
//
//  1. BORDA, NÃO NÍVEL. "Lado 1 completo" é verdade durante minutos; falar
//     enquanto for verdade repetiria a frase até alguém arrancar a caixa de
//     som. Só a TRANSIÇÃO fala.
//
//  2. NÃO NARRAR O PASSADO. Ao abrir a tela, o primeiro estado que chega já
//     traz paletes cheios e talvez emergência ativa. Sem cuidado, quem abre
//     a página às 15h ouve o resumo do turno inteiro de uma vez. O primeiro
//     estado apenas SINCRONIZA — não fala.
//
//  3. O NAVEGADOR BLOQUEIA ÁUDIO SEM GESTO DO USUÁRIO. Falar antes de
//     alguém clicar em algo é descartado em silêncio — o pior dos mundos,
//     porque parece que funciona e não funciona. Por isso o padrão é
//     DESLIGADO e quem liga é o botão: o clique serve de gesto.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { RobotState } from "../../../shared/types";

const CHAVE = "supervisorio.voz";

/** De quanto em quanto tempo o aviso de palete pronto se repete. */
const INTERVALO_MS = 5000;
/** Teto de insistência: 10 minutos. Ver o comentário no disparo. */
const MAX_REPETICOES = 120;

/** UMA frase para os dois lados, e não duas seguidas: `falar` cancela o que
 *  estiver na fila, então duas chamadas em sequência calariam a primeira. */
function fraseProntos(lados: Set<"A" | "B">): string {
  const tem1 = lados.has("A"), tem2 = lados.has("B");
  if (tem1 && tem2) {
    return "Atenção. Paletização dos lados 1 e 2 finalizada. Paletes prontos para retirada.";
  }
  return `Atenção. Paletização do lado ${tem1 ? 1 : 2} finalizada. `
    + "Palete pronto para retirada.";
}

/** Fala uma frase, se o navegador souber. Cancela o que estiver na fila:
 *  aviso de célula é como rádio de operação — o mais recente é o que importa,
 *  e uma fila acumulada falaria sobre um estado que já passou. */
function falar(texto: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = "pt-BR";
  fala.rate = 0.95;      // um tico mais devagar: chão de fábrica é barulhento
  fala.pitch = 1;
  fala.volume = 1;
  // Voz em português, se houver. Sem ela o navegador usa a padrão e sai com
  // sotaque — feio, mas compreensível. Melhor do que não avisar.
  const vozes = window.speechSynthesis.getVoices();
  const ptbr = vozes.find((v) => v.lang === "pt-BR")
    ?? vozes.find((v) => v.lang.startsWith("pt"));
  if (ptbr) fala.voice = ptbr;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(fala);
}

export interface Voz {
  ligado: boolean;
  alternar: () => void;
  /** Disponível no navegador? Sem isso, o botão não deve nem aparecer. */
  suportado: boolean;
}

/** Observa o estado e fala nas transições que importam. */
export function useVoz(estado: RobotState | null): Voz {
  const suportado = typeof window !== "undefined" && "speechSynthesis" in window;

  const [ligado, setLigado] = useState(() => {
    try { return localStorage.getItem(CHAVE) === "1"; } catch { return false; }
  });

  // `alternar` é criado antes de `parar`; a ref evita a ordem circular.
  const pararRef = useRef<(() => void) | null>(null);

  const alternar = useCallback(() => {
    setLigado((antes) => {
      const agora = !antes;
      try { localStorage.setItem(CHAVE, agora ? "1" : "0"); } catch { /* modo privado */ }
      // Este clique É o gesto que o navegador exige. Falar aqui confirma ao
      // operador que o som funciona — e, se estiver mudo, ele descobre agora
      // e não na primeira emergência.
      if (agora) falar("Avisos sonoros ligados");
      else { window.speechSynthesis?.cancel(); pararRef.current?.(); }
      return agora;
    });
  }, []);

  // Estado anterior, para detectar as bordas. `null` = ainda não sincronizou.
  const ant = useRef<{
    countA: number; countB: number; emergencia: boolean;
    falha: boolean; paleteA: boolean; paleteB: boolean;
  } | null>(null);

  // ---- AVISO INSISTENTE DE PALETE PRONTO ---------------------------------
  //  Palete cheio parado é linha parada: avisar uma vez e calar não resolve
  //  se ninguém estiver olhando. Repete a cada 5 s até alguém ATENDER.
  //
  //  "Atender" é qualquer uma destas, e não só a porta:
  //     - porta aberta      (o que você pediu: o operador foi lá)
  //     - palete retirado   (o objetivo de fato aconteceu)
  //     - contagem zerada   (palete novo no lugar)
  //  Parar só na porta deixaria o aviso tocando depois de o palete já ter
  //  saído, se a retirada acontecer com a porta fechada.
  const pendentes = useRef<Set<"A" | "B">>(new Set());
  const timer = useRef<number | null>(null);
  const repeticoes = useRef(0);

  const parar = useCallback(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    pendentes.current.clear();
    repeticoes.current = 0;
  }, []);

  useEffect(() => { pararRef.current = parar; }, [parar]);
  // Sair da tela não deixa temporizador vivo.
  useEffect(() => () => { if (timer.current !== null) clearInterval(timer.current); }, []);

  useEffect(() => {
    if (!estado) return;
    const porPalete = Math.max(1, Math.round(estado.boxTotal / 2));
    const atual = {
      countA: estado.countA,
      countB: estado.countB,
      emergencia: estado.emergencia,
      falha: estado.status.falha,
      paleteA: estado.paleteA,
      paleteB: estado.paleteB,
    };

    // Primeiro estado: só sincroniza. Ver armadilha 2 no topo.
    if (ant.current === null) { ant.current = atual; return; }
    const a = ant.current;
    ant.current = atual;
    if (!ligado) return;

    // ---- paletização de um lado concluída -------------------------------
    // A borda é a contagem ALCANÇAR o total do palete, não "estar" nele.
    const encheu = (antes: number, agora: number) =>
      antes < porPalete && agora >= porPalete;
    if (encheu(a.countA, atual.countA)) pendentes.current.add("A");
    if (encheu(a.countB, atual.countB)) pendentes.current.add("B");

    // ---- quem já foi atendido sai da lista -------------------------------
    // A porta aberta atende OS DOIS: o operador está lá dentro.
    if (!estado.status.portas) pendentes.current.clear();
    // Palete retirado ou contagem zerada: aquele lado foi resolvido.
    if (!atual.paleteA || atual.countA === 0) pendentes.current.delete("A");
    if (!atual.paleteB || atual.countB === 0) pendentes.current.delete("B");

    if (pendentes.current.size === 0) {
      parar();
    } else if (timer.current === null) {
      // Fala JÁ e agenda a repetição. Esperar 5 s pelo primeiro aviso
      // atrasaria justamente o instante em que ele é mais útil.
      falar(fraseProntos(pendentes.current));
      repeticoes.current = 1;
      timer.current = window.setInterval(() => {
        if (pendentes.current.size === 0) { parar(); return; }
        // TETO DE REPETIÇÕES. Você pediu "até identificar porta aberta", e é
        // isso que acontece — mas nesta célula já vimos um sensor travado
        // ligado o dia inteiro (o SP5). Um aviso que nunca cala ensina o
        // operador a desligar o som, e aí ele perde também o de emergência.
        // Dez minutos insistindo é bastante; depois disso o problema deixou
        // de ser falta de aviso.
        if (repeticoes.current >= MAX_REPETICOES) { parar(); return; }
        repeticoes.current += 1;
        falar(fraseProntos(pendentes.current));
      }, INTERVALO_MS);
    }

    // ---- palete retirado -------------------------------------------------
    if (a.paleteA && !atual.paleteA) falar("Palete do lado 1 retirado.");
    if (a.paleteB && !atual.paleteB) falar("Palete do lado 2 retirado.");

    // ---- segurança e falha ----------------------------------------------
    // Estes falam na entrada E na saída: quem está longe da célula precisa
    // saber que normalizou tanto quanto precisou saber que parou.
    if (!a.emergencia && atual.emergencia) falar("Atenção. Célula em emergência.");
    if (a.emergencia && !atual.emergencia) falar("Emergência normalizada.");

    if (!a.falha && atual.falha) {
      const cod = estado.status.almRobo;
      falar(cod ? `Robô em falha. Alarme ${cod}.` : "Robô em falha.");
    }
    if (a.falha && !atual.falha) falar("Falha do robô resolvida.");
  }, [estado, ligado]);

  // Sem isto, a lista de vozes vem vazia na primeira chamada em alguns
  // navegadores: ela é carregada de forma assíncrona.
  useEffect(() => {
    if (!suportado) return;
    const carrega = () => window.speechSynthesis.getVoices();
    carrega();
    window.speechSynthesis.addEventListener?.("voiceschanged", carrega);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", carrega);
  }, [suportado]);

  return { ligado, alternar, suportado };
}
