// ============================================================================
//  Enlace com o servidor: um WebSocket, reconexão automática e o estado do
//  robô como dado React.
//
//  Duas cadências de propósito:
//   - `state`  (React, ~25 Hz)  -> painéis de texto, fases, lâmpadas
//   - `liveRef` (ref, sem render) -> a cena 3D lê no useFrame, a 60 fps,
//     interpolando entre quadros de rede sem forçar render de React nenhum.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import type { ClientCmd, HelloMsg, RobotState, ServerMsg } from "../../../shared/types";

export interface RobotLink {
  state: RobotState | null;
  phases: string[];
  layout: HelloMsg["layout"];
  connected: boolean;
  /** Quando chegou o último sinal de que os DADOS estão vivos: um quadro de
   *  estado, ou um pulso dizendo que a fonte fala. Ref, não estado: quem lê
   *  é um cronômetro, e isto muda 25 vezes por segundo. */
  ultimoDadoRef: React.MutableRefObject<number>;
  liveRef: React.MutableRefObject<RobotState | null>;
  send: (cmd: ClientCmd) => void;
}

const LAYOUT_PADRAO: HelloMsg["layout"] = {
  pick: { r: 1150, top: 550 },
  pallet: { size: 1200, top: 150, r: 1150 },
  box: { w: 500, d: 150, h: 570 },
  pedestal: 400,
};

export function useRobot(): RobotLink {
  const [state, setState] = useState<RobotState | null>(null);
  const [phases, setPhases] = useState<string[]>([]);
  const [layout, setLayout] = useState(LAYOUT_PADRAO);
  const [connected, setConnected] = useState(false);
  const liveRef = useRef<RobotState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ultimoRender = useRef(0);
  const ultimoDadoRef = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout>;

    // Espera ate a proxima tentativa. Cresce a cada falha ate 30 s.
    //
    // Era 1 s FIXO, e com a TV atras de um alternador de abas isso significava
    // uma conexao nova por segundo enquanto a rede estivesse ruim - cada uma
    // virando mais um socket para o servidor alimentar a 25 fps.
    let espera = 1000;

    function connect() {
      if (!alive || document.hidden) return;

      // Ja ha um enlace de pe ou a caminho: abrir outro so duplica.
      const atual = wsRef.current;
      if (atual && (atual.readyState === WebSocket.OPEN
                 || atual.readyState === WebSocket.CONNECTING)) return;

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        espera = 1000;                 // conexao boa zera a penalidade
        // Conexão nova ganha crédito: o primeiro quadro pode demorar, e
        // contar o tempo de espera como "sem dado" acusaria falha em quem
        // acabou de chegar.
        ultimoDadoRef.current = Date.now();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.type === "hello") {
          setPhases(msg.phases);
          setLayout(msg.layout);
        } else if (msg.type === "pulso") {
          // O PULSO só conta como sinal de vida se a FONTE estiver falando.
          // Servidor de pé com a fonte muda não é comunicação — é uma tela
          // bonita mostrando o passado, e é justamente o caso que o operador
          // descreve como "travou".
          if (msg.fonteViva) ultimoDadoRef.current = Date.now();
        } else if (msg.type === "state") {
          ultimoDadoRef.current = Date.now();
          // `placed` e `status` só vêm quando mudam — ausentes, valem os
          // últimos recebidos. É daqui que sai a economia de banda: eram
          // 76,5 % do tráfego, retransmitidos 25 vezes por segundo embora
          // mudem umas três vezes por minuto. Ver StateMsg em shared/types.
          //
          // O primeiro quadro depois de conectar (e depois de trocar de
          // fonte) vem completo pelo servidor, então nunca se monta um
          // estado sem pilha.
          const anterior = liveRef.current;
          const completo = { ...(anterior ?? {}), ...msg } as RobotState;
          liveRef.current = completo;

          // ------------------------------------------------------------------
          //  A REF A 25 Hz, O ESTADO REACT A 5 Hz
          //
          //  A cena 3D lê a ref dentro de `useFrame` e não depende de render
          //  nenhum. Quem usa `state` é o PAINEL DE TEXTO — fases, contagens,
          //  lâmpadas — e ninguém lê texto 25 vezes por segundo.
          //
          //  Antes, cada quadro de rede disparava um render do App, e com ele
          //  a reconciliação da árvore inteira: robô, célula e as 64 caixas,
          //  25 vezes por segundo, concorrendo com o laço de 60 fps que de
          //  fato desenha. Em PC modesto isso aparece como queda de fps.
          // ------------------------------------------------------------------
          const agora = Date.now();
          if (agora - ultimoRender.current >= 200) {
            ultimoRender.current = agora;
            setState(completo);
          }
        }
      };
      ws.onclose = () => {
        setConnected(false);
        // Perder o enlace NÃO congela a tela em silêncio: o estado fica, o
        // selo SEM COMUNICAÇÃO acende, e a reconexão insiste sozinha.
        //
        // Com a aba oculta NAO se reconecta: quem fechou o enlace foi o
        // visibilitychange abaixo, de proposito.
        if (alive && !document.hidden) {
          retry = setTimeout(connect, espera);
          espera = Math.min(espera * 2, 30_000);
        }
      };
    }

    // ---------------------------------------------------------------------
    //  ABA OCULTA SOLTA O ENLACE
    //
    //  O navegador CONGELA aba em segundo plano: o socket continua aberto e o
    //  JavaScript para de drenar. O servidor, sem saber, segue mandando 25
    //  quadros por segundo para um buffer que ninguem esvazia - foi o que
    //  estourou a memoria da instancia a cada ~10 min.
    //
    //  Esta tela vive num PC com alternador de abas, transmitindo para a TV da
    //  celula. Ou seja: oculta a maior parte do tempo. Soltar o enlace nessa
    //  hora nao perde nada - aba oculta nao desenha - e devolve ao servidor a
    //  certeza de que nao ha ninguem para alimentar.
    // ---------------------------------------------------------------------
    function aoTrocarVisibilidade() {
      if (document.hidden) {
        clearTimeout(retry);
        wsRef.current?.close();
        return;
      }
      // Voltou a aparecer: reconecta JA, sem herdar a penalidade de antes.
      espera = 1000;
      clearTimeout(retry);
      connect();
    }

    document.addEventListener("visibilitychange", aoTrocarVisibilidade);
    connect();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const send = (cmd: ClientCmd) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  };

  return { state, phases, layout, connected, liveRef, ultimoDadoRef, send };
}
