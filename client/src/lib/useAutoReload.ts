// ============================================================================
//  RECARGA AUTOMÁTICA quando o dado para de chegar
//
//  Sem atualização por 20 s, a página se recarrega sozinha. Na prática a
//  comunicação volta — e é isso que este arquivo automatiza, para ninguém
//  precisar estar na frente do monitor para apertar F5.
//
//  ------------------------------------------------- DUAS TENTATIVAS, E PARA
//  O limite é o que torna isto um DIAGNÓSTICO em vez de um laço.
//
//  Recarregar refaz o enlace navegador↔servidor: socket morto, aba que
//  dormiu, contêiner do Render que reciclou. Se era isso, uma recarga
//  resolve — no máximo duas.
//
//  Se depois de duas o dado continuar sem chegar, a causa NÃO está no
//  navegador. Está no caminho gateway↔CLP, e a terceira recarga encontraria
//  exatamente o mesmo silêncio. Continuar tentando seria pior do que parar:
//  a tela piscaria para sempre, escondendo uma falha de campo atrás de um
//  sintoma de navegador, e ninguém iria olhar o CLP.
//
//  Por isso, esgotadas as duas, a tela PARA e diz o que sabe. Chegar nesse
//  estado é informação: a essa altura o problema é a obtenção de dados do
//  CLP, e é para lá que alguém tem de ir.
//
//  ------------------------------------------------- O QUE CONTA COMO "DADO"
//  Não é "chegou mensagem". O protocolo é delta — quadro sem novidade não é
//  enviado —, então silêncio na rede é o estado NORMAL de uma célula parada.
//  Disparar em cima do silêncio recarregaria a tela toda vez que o robô
//  ficasse um minuto sem se mexer.
//
//  O que conta é: um quadro de estado, OU um pulso do servidor dizendo que a
//  fonte está falando. Quem sabe disso é o servidor, e é por isso que o
//  pulso existe (ver PulsoMsg em shared/types).
// ============================================================================
import { useEffect, useRef, useState } from "react";

/** Quanto tempo sem dado antes de recarregar. */
const ESPERA_S = 20;
/** Quantas recargas automáticas antes de desistir e acusar o CLP. */
const MAX_TENTATIVAS = 2;
/** Contagem entre recargas: sessão sobrevive ao reload e morre com a aba. */
const CHAVE = "supervisorio.recargas";

export interface AutoReload {
  /** Segundos até recarregar. `null` = não está contando. */
  faltam: number | null;
  /** Recargas automáticas já feitas nesta sequência de falha. */
  tentativas: number;
  /** Esgotou as tentativas: daqui em diante é problema de dado do CLP. */
  desistiu: boolean;
}

export function useAutoReload(ultimoDadoRef: {
  current: number;
}): AutoReload {
  const [faltam, setFaltam] = useState<number | null>(null);
  const [tentativas] = useState(() => {
    try { return Number(sessionStorage.getItem(CHAVE) ?? 0); } catch { return 0; }
  });
  const [desistiu, setDesistiu] = useState(tentativas >= MAX_TENTATIVAS);
  const zerado = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const parado = (Date.now() - ultimoDadoRef.current) / 1000;

      // ---- VOLTOU --------------------------------------------------------
      if (parado < ESPERA_S / 2) {
        setFaltam(null);
        // Zera a contagem UMA vez por recuperação. O contador mede a
        // sequência atual de falha; sobrevivendo à recuperação, o número na
        // tela viraria o histórico do turno e ninguém saberia se a queda é
        // de agora.
        if (!zerado.current && tentativas > 0) {
          zerado.current = true;
          try { sessionStorage.removeItem(CHAVE); } catch { /* modo privado */ }
        }
        return;
      }
      zerado.current = false;

      // ---- SEM DADO ------------------------------------------------------
      if (desistiu) { setFaltam(null); return; }

      const resta = Math.ceil(ESPERA_S - parado);
      if (resta > 0) { setFaltam(resta); return; }

      if (tentativas + 1 > MAX_TENTATIVAS) { setDesistiu(true); return; }
      try {
        sessionStorage.setItem(CHAVE, String(tentativas + 1));
      } catch { /* modo privado: recarrega igual, só perde a contagem */ }
      // `reload()` e não troca de href: mantém URL e histórico, e é o que
      // refaz a conexão sem passar por navegação nova.
      location.reload();
    }, 250);

    return () => clearInterval(t);
  }, [ultimoDadoRef, tentativas, desistiu]);

  return { faltam, tentativas, desistiu };
}
