// ============================================================================
//  HISTÓRICO DE CORRENTE dos acionamentos
//
//  A corrente é o número mais valioso da tela do inversor, e o valor
//  instantâneo é o menos útil dele: 0,98 A não diz nada sozinho. O que diz é
//  o DESENHO — degrau quando a carga entra, patamar em regime, e sobretudo o
//  patamar de hoje mais alto que o da semana passada, que é rolamento
//  travando ou correia tensionada.
//
//  Três minutos não revelam desgaste de semanas; revelam o ciclo. Serve para
//  ver a esteira partindo, carregando e parando, e para notar um regime que
//  não é o de sempre. A tendência longa mora no historiador, não aqui.
//
//  ---------------------------------------------------- POR QUE AQUI EM CIMA
//  O histórico NÃO pode morar na tela do inversor. Em modo apresentação essa
//  tela desmonta a cada 15 s, e o gráfico recomeçaria vazio toda vez — daria
//  para ver os pontos nascendo do zero e nunca um minuto inteiro. Vivendo no
//  App, que fica montado, a aba volta e encontra a série pronta.
//
//  --------------------------------------------------- POR QUE UM RELÓGIO
//  As amostras saem de um `setInterval`, não da chegada de quadros. O
//  protocolo é delta: esteira parada não muda nada, nada é enviado, e o
//  gráfico amostrado por quadro simplesmente CONGELARIA — o eixo do tempo
//  pararia junto com a máquina, e uma parada de dois minutos ficaria
//  invisível. Com relógio próprio, parada vira o que ela é: uma linha reta no
//  zero, com dois minutos de comprimento.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import type { Inversores } from "../../../shared/types";

/** Uma amostra por segundo, 180 pontos: três minutos de janela. */
const INTERVALO_MS = 1000;
export const HIST_PONTOS = 180;

export interface Historico {
  entrada: number[];
  balanca: number[];
}

export function useHistorico(inversores: Inversores | undefined): Historico {
  const serie = useRef<Historico>({ entrada: [], balanca: [] });
  // O último estado conhecido, para o relógio ter o que amostrar quando não
  // chega quadro nenhum.
  const atual = useRef<Inversores | undefined>(inversores);
  atual.current = inversores;

  // Um contador só para forçar o repinte de segundo em segundo. Sem ele o
  // gráfico só se mexeria quando a rede falasse — e o silêncio, que é
  // justamente o que ele precisa desenhar, não apareceria.
  const [, bate] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      const inv = atual.current;
      empurra(serie.current.entrada, inv?.entrada?.corrente ?? 0);
      empurra(serie.current.balanca, inv?.balanca?.corrente ?? 0);
      bate((n) => (n + 1) % 1000);
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, []);

  return serie.current;
}

function empurra(v: number[], x: number) {
  v.push(x);
  if (v.length > HIST_PONTOS) v.shift();
}
