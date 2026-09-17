import { useEffect, useMemo, useState } from "react";
import { Cell } from "./scene/Cell";
import { Panel } from "./ui/Panel";
import { BarraAbas } from "./ui/BarraAbas";
import type { ItemAba } from "./ui/BarraAbas";
import { TelaInversor } from "./ui/TelaInversor";
import { MotoresSobreCena } from "./ui/MotoresSobreCena";
import { useRobot } from "./lib/useRobot";
import { useVoz } from "./lib/useVoz";
import { useAutoReload } from "./lib/useAutoReload";
import { useAbas } from "./lib/useAbas";
import type { Aba } from "./lib/useAbas";
import { useHistorico } from "./lib/useHistorico";

/** Data e hora do turno, batendo de segundo em segundo.
 *
 *  Relógio próprio, e não derivado do estado que chega da célula: se a fonte
 *  parar, o relógio continua andando e é o SELO ao lado que denuncia a parada.
 *  Um relógio que congela junto pareceria tela travada, e travada ela não
 *  está — o dado é que sumiu. */
function Relogio() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="relogio">
      {agora.toLocaleDateString("pt-BR")}
      <b>{agora.toLocaleTimeString("pt-BR")}</b>
    </span>
  );
}

export function App() {
  const robot = useRobot();
  const voz = useVoz(robot.state);
  //  Sem DADO por 20 s, a página se recarrega sozinha — duas vezes, e para.
  //  Duas bastam para o que o navegador consegue consertar; persistindo
  //  depois disso, a causa é a obtenção de dados do CLP, e insistir só
  //  esconderia uma falha de campo. Ver a nota no próprio hook.
  const recarga = useAutoReload(robot.ultimoDadoRef);

  const inv = robot.state?.inversores;
  const serie = useHistorico(inv);

  // O rodízio da apresentação só passa por abas COM DADO. Enquanto as
  // chamadas do bloco 09 não estiverem no Main, os dois inversores são
  // `null` e o rodízio ficaria dois terços do tempo em telas vazias.
  const temEntrada = Boolean(inv?.entrada);
  const temBalanca = Boolean(inv?.balanca);
  const comDado = useMemo<Aba[]>(() => {
    const v: Aba[] = ["processo"];
    if (temEntrada) v.push("entrada");
    if (temBalanca) v.push("balanca");
    return v;
  }, [temEntrada, temBalanca]);

  const abas = useAbas(comDado);

  const itens: ItemAba[] = [
    { id: "processo", rotulo: "PROCESSO" },
    {
      id: "entrada",
      rotulo: "ESTEIRA DE ENTRADA",
      vazia: !inv?.entrada,
      alarme: Boolean(inv?.entrada && (inv.entrada.erro || inv.entrada.bloqueado)),
    },
    {
      id: "balanca",
      rotulo: "ESTEIRA DA BALANÇA",
      vazia: !inv?.balanca,
      alarme: Boolean(inv?.balanca && (inv.balanca.erro || inv.balanca.bloqueado)),
    },
  ];

  return (
    <div className="wrap">
      <header>
        <h1>ROBÔ GP12 YASKAWA - DIGITAL TWIN</h1>
        <span className="spacer" />
        <Relogio />
        {/* O SELO FALA EM VOZ ALTA o que está acontecendo. Tela que se
            recarrega sozinha sem avisar parece defeito de monitor; e tela que
            desistiu de recarregar, sem dizer, parece congelada. Os dois
            estados precisam estar escritos. */}
        {recarga.desistiu ? (
          <span className="pill off">
            SEM DADOS APÓS 2 RECARGAS · VERIFICAR CLP
          </span>
        ) : recarga.faltam !== null ? (
          <span className="pill off">
            SEM ATUALIZAÇÃO · RECARGA EM {recarga.faltam}s
            {recarga.tentativas > 0 && ` · ${recarga.tentativas}ª TENTATIVA`}
          </span>
        ) : !robot.connected ? (
          <span className="pill off">SEM COMUNICAÇÃO</span>
        ) : robot.state?.fonte === "real" ? (
          robot.state.realOk
            ? <span className="pill ok">TEMPO REAL</span>
            : <span className="pill off">SEM DADOS REAIS</span>
        ) : (
          <span className="pill sim">DADOS SIMULADOS</span>
        )}
      </header>

      <BarraAbas abas={abas} itens={itens} />

      {/* As abas do acionamento ocupam a LARGURA INTEIRA, sem o painel do
          lado. Não é economia de código: é que a tela de um inversor existe
          para ser lida de longe, e os controles de fonte e simulação não têm
          o que fazer ali — nada nesta tela comanda coisa alguma. Quem precisa
          deles volta para PROCESSO, que é onde eles atuam. */}
      {abas.aba === "entrada" && (
        <TelaInversor nome="INVERSOR · ESTEIRA DE ENTRADA"
                      inv={inv?.entrada ?? null} serie={serie.entrada} />
      )}
      {abas.aba === "balanca" && (
        <TelaInversor nome="INVERSOR · ESTEIRA DA BALANÇA"
                      inv={inv?.balanca ?? null} serie={serie.balanca} />
      )}

      {/* A cena 3D fica MONTADA o tempo todo, só escondida — o `hidden` é
          deliberado. Desmontar o Canvas jogaria fora o contexto WebGL a cada
          troca de aba, e em apresentação isso seria quatro vezes por minuto:
          a volta ao PROCESSO viria com meio segundo de tela preta enquanto o
          navegador recria tudo. Escondida, ela reaparece pronta. */}
      <div className="grid" hidden={abas.aba !== "processo"}>
        <section className="card stage">
          <div className="canvas-box">
            <Cell
              live={robot.liveRef}
              layout={robot.layout}
              placed={robot.state?.placed ?? []}
            />
          </div>
          {/* Aqui ficava um PLACAR com PEÇAS OK e PEÇAS NOK em corpo grande.
              Saiu: a contagem por turno virou assunto do dashboard do SYNC,
              que a lê da `ventilador_pesagens` e sobrevive a um F5 desta
              tela. Duas fontes para a mesma pergunta, divergindo por um,
              valem menos que uma.

              No lugar entrou o estado dos dois acionamentos — porque na TV o
              rodízio é entre o dashboard e esta aba, e ninguém vai clicar em
              ENTRADA ou BALANÇA de passagem. O que era repetição virou o
              único lugar onde essa informação aparece sem um clique. */}
          <MotoresSobreCena inv={inv} />
          <span className="dica">ARRASTE PARA ORBITAR · RODA PARA APROXIMAR</span>
        </section>

        <Panel robot={robot} voz={voz} />
      </div>

      {/* Sem rodapé explicativo: era nota de desenvolvimento, não informação
          de operação. Quem abre esta tela quer ver a célula, não ler sobre
          ela — o "como funciona" mora no README e nos comentários do código. */}
    </div>
  );
}
