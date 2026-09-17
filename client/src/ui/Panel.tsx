// ============================================================================
//  Painel lateral: o que o operador precisa decidir olhando de longe.
//
//  Só DISPOSITIVO DE CAMPO — estado da célula, ROBÔ e SEGURANÇA. Produção
//  saiu para o dashboard do SYNC; garra, ar e paletização saíram antes, por
//  serem detalhe de manutenção competindo por atenção com o que faz alguém
//  agir. O resto são controles, não indicadores.
// ============================================================================
import type { RobotLink } from "../lib/useRobot";
import type { Voz } from "../lib/useVoz";

/** Um sinal de status: rótulo + estado.
 *
 *  A cor NÃO é decoração — só aparece quando o sinal exige atenção. Tela em
 *  que tudo é colorido não tem destaque nenhum; quem olha de longe precisa
 *  que só o problema salte. */
function Sinal({ rotulo, valor, alerta }: {
  rotulo: string;
  valor: string;
  /** "ruim" pinta vermelho, "atencao" âmbar, undefined fica neutro. */
  alerta?: "ruim" | "atencao";
}) {
  return (
    <div className={"sinal" + (alerta ? ` ${alerta}` : "")}>
      <span className="sinal-rot">{rotulo}</span>
      <span className="sinal-val">{valor}</span>
    </div>
  );
}


export function Panel({ robot, voz }: { robot: RobotLink; voz: Voz }) {
  const st = robot.state;
  const moving = Boolean(st && st.running && st.speed > 2);
  const trocando = st?.phase === -1;

  return (
    <aside>
      <section className="card">
        <div className={"state" + (moving ? " on" : "") + (st?.emergencia ? " emerg" : "")}>
          <span className="lamp" />
          <b>
            {!robot.connected
              ? "SEM COMUNICAÇÃO"
              : st?.emergencia
                ? "CÉLULA EM EMERGÊNCIA"
                : trocando
                  ? "TROCA DE PALETES"
                  : moving
                    ? "EM MOVIMENTO"
                    : "PARADO"}
          </b>
        </div>
        {/* Sem mostradores de junta, TCP e velocidade: em modo REAL esses
            números são GERADOS pelo gêmeo, não medidos no robô. Número que
            ninguém mediu não vai para a tela de quem opera. */}
      </section>

      {/* Aqui ficava o card PRODUÇÃO — peças, ritmo, refugo, turno anterior,
          acumulado. Saiu inteiro: contagem é do dashboard do SYNC, que a lê
          do banco e não zera num F5 nem depende desta aba estar aberta.

          Esta tela ficou com o que só ela sabe: o estado dos DISPOSITIVOS DE
          CAMPO — robô, sensores, acionamentos, segurança. É a pergunta "o que
          está acontecendo na célula agora", e não "quanto saiu hoje"; as duas
          se atrapalhavam disputando a mesma coluna. */}

      {/* ============ ROBÔ: está em condição de produzir? ============ */}
      {st && (
        <section className="card">
          <div className="card-title">ROBÔ</div>
          <div className="sinais">
            <Sinal
              rotulo="COMANDO"
              valor={st.status.remoto ? "REMOTO" : "LOCAL"}
              alerta={st.status.remoto ? undefined : "atencao"}
            />
            <Sinal
              rotulo="SERVO"
              valor={st.status.servoOn ? "LIGADO" : "DESLIGADO"}
              alerta={st.status.servoOn ? undefined : "atencao"}
            />
            <Sinal
              rotulo="CICLO"
              valor={st.status.emCiclo ? "EM CICLO" : "PARADO"}
            />
            <Sinal
              rotulo="POSIÇÃO"
              valor={st.status.emHome ? "EM HOME" : "FORA DE HOME"}
            />
            <Sinal
              rotulo="FALHA"
              valor={st.status.falha ? `SIM · ${st.status.almRobo}` : "NÃO"}
              alerta={st.status.falha ? "ruim" : undefined}
            />
            <Sinal
              rotulo="LADO ATIVO"
              valor={st.status.ladoAtivo === 0 ? "—" : `PALETE ${st.status.ladoAtivo === 1 ? "A" : "B"}`}
            />
          </div>
        </section>
      )}

      {/* ============ SEGURANÇA: por que não dá para religar? ============

          Dividido em AMBOS e um bloco por lado. O `PORTAS: ABERTA` de antes
          era o `&&` das duas chaves: dizia que havia porta aberta e não qual
          — e nesta célula isso muda a ação. O robô é UM só atendendo dois
          lados espelhados, então porta do lado 01 aberta com o lado 02
          fechado é uma célula que continua paletizando de um lado; as duas
          abertas é uma célula que não vai a lugar nenhum.

          EMERGÊNCIA e MODO ficam SOLTOS no topo, sem divisor: são da célula
          inteira — a emergência é uma cadeia só, e o automático é o modo do
          CLP, não de um lado. Rotulá-los de "ambos os lados" era responder a
          uma pergunta que ninguém fez; o que precisa de nome é o que vem
          depois, porque aí sim existem dois de cada.

          A LEITURA É `1 = FECHADA / LIVRE`, herdada de como o HR11 já era
          lido antes desta divisão. Os contatos de segurança da célula são NF
          (soltos leem 1), o que é coerente — mas isto NÃO foi medido bit a
          bit nestes quatro sinais. Se estiver invertido, agora aparecem
          quatro linhas erradas em vez de duas. */}
      {st && (
        <section className="card">
          <div className="card-title">SEGURANÇA</div>
          <div className="sinais">
            <Sinal
              rotulo="EMERGÊNCIA"
              valor={st.emergencia ? "ATIVA" : "LIVRE"}
              alerta={st.emergencia ? "ruim" : undefined}
            />
            <Sinal
              rotulo="MODO"
              valor={st.status.automatico ? "AUTOMÁTICO" : "MANUAL"}
              alerta={st.status.automatico ? undefined : "atencao"}
            />
          </div>

          <div className="sub-title">LADO 01</div>
          <div className="sinais">
            <Sinal
              rotulo="PORTA"
              valor={st.status.porta1 ? "FECHADA" : "ABERTA"}
              alerta={st.status.porta1 ? undefined : "ruim"}
            />
            <Sinal
              rotulo="BARREIRA"
              valor={st.status.barreira1 ? "LIVRE" : "INTERROMPIDA"}
              alerta={st.status.barreira1 ? undefined : "ruim"}
            />
          </div>

          <div className="sub-title">LADO 02</div>
          <div className="sinais">
            <Sinal
              rotulo="PORTA"
              valor={st.status.porta2 ? "FECHADA" : "ABERTA"}
              alerta={st.status.porta2 ? undefined : "ruim"}
            />
            <Sinal
              rotulo="BARREIRA"
              valor={st.status.barreira2 ? "LIVRE" : "INTERROMPIDA"}
              alerta={st.status.barreira2 ? undefined : "ruim"}
            />
          </div>
        </section>
      )}

      {/* AVISOS FALADOS. Padrao DESLIGADO, e o clique daqui e o gesto que o
          navegador exige para deixar tocar audio -- sem ele, a primeira fala
          seria descartada em silencio. O botao nao aparece onde o navegador
          nao souber falar. */}
      {voz.suportado && (
        <section className="card">
          <div className="card-title">AVISOS SONOROS</div>
          <div className="controls">
            <button className={voz.ligado ? "ativo" : ""} onClick={voz.alternar}>
              {voz.ligado ? "SOM LIGADO" : "SOM DESLIGADO"}
            </button>
          </div>
        </section>
      )}

      {/* ============ CONEXÃO COM O BROKER ============

          Três linhas porque são TRÊS FALHAS DIFERENTES, e o `SEM DADOS
          REAIS` do cabeçalho junta as três numa frase só — que diz que algo
          está errado sem dizer onde ir.

            BROKER sem conexão ...... rede, credencial, cluster fora do ar
            ÚLTIMO DADO envelhecendo  broker de pé, mas o MTR Scale parou de
                                      publicar (programa fechado, Modbus 503
                                      mudo)
            CLP sem heartbeat ....... o HR26 parou: o CLP é que morreu, e o
                                      resto do caminho está inteiro

          Só com a fonte em REAL. No simulador não há broker, e um card de
          conexão ali seria um instrumento medindo coisa nenhuma. */}
      {st?.fonte === "real" && (
        <section className="card">
          <div className="card-title">CONEXÃO MQTT</div>
          <div className="sinais">
            <Sinal
              rotulo="BROKER"
              valor={st.mqtt.conectado ? "CONECTADO" : "SEM CONEXÃO"}
              alerta={st.mqtt.conectado ? undefined : "ruim"}
            />
            {/* Idade, e não relógio: "há 2 s" se lê sem comparar com nada.
                Acima de 5 s o quadro deixa de valer — é o mesmo FRESCOR_MS
                que o servidor usa para derrubar o `realOk`, e por isso a
                cor muda exatamente onde a tela para de confiar no dado. */}
            <Sinal
              rotulo="ÚLTIMO DADO"
              valor={
                st.mqtt.ultimoQuadroMs === null
                  ? "NENHUM"
                  : `HÁ ${Math.floor(st.mqtt.ultimoQuadroMs / 1000)} s`
              }
              alerta={
                st.mqtt.ultimoQuadroMs === null || st.mqtt.ultimoQuadroMs >= 5000
                  ? "ruim"
                  : undefined
              }
            />
            <Sinal
              rotulo="CLP"
              valor={st.mqtt.plcOk ? "RESPONDENDO" : "SEM HEARTBEAT"}
              alerta={st.mqtt.plcOk ? undefined : "ruim"}
            />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-title">
          FONTE DE DADOS
          {st?.fonte === "real" && !st.realOk ? " · SEM DADOS" : ""}
        </div>
        <div className="controls">
          <div className="dev-row">
            <button
              className={st?.fonte === "real" ? "ativo" : ""}
              disabled={!robot.connected}
              onClick={() => robot.send({ cmd: "fonte", value: "real" })}
            >
              REAL {st?.realOk ? "●" : "○"}
            </button>
            <button
              className={st?.fonte !== "real" ? "ativo" : ""}
              disabled={!robot.connected}
              onClick={() => robot.send({ cmd: "fonte", value: "sim" })}
            >
              SIMULADOR
            </button>
          </div>
        </div>
      </section>

      {/* SÓ COM O SIMULADOR NO AR. PAUSAR e RITMO mexem no gêmeo, não na
          célula — com a fonte em REAL eles não têm efeito nenhum, e um botão
          PAUSAR grande ao lado de uma cena que espelha a célula de verdade é
          um convite a alguém achar que parou a máquina.

          A condição é `=== "sim"`, e não `!== "real"`, porque antes do
          primeiro quadro `fonte` é `undefined`: com a negação, o card
          apareceria por um instante a cada abertura da tela, que é quando
          ninguém ainda sabe o que está vendo. */}
      {st?.fonte === "sim" && (
      <section className="card">
        <div className="card-title">SIMULAÇÃO</div>
        <div className="controls">
          <button
            disabled={!robot.connected}
            onClick={() => robot.send({ cmd: "run", value: !(st?.running ?? true) })}
          >
            {st?.running ?? true ? "PAUSAR" : "INICIAR"}
          </button>
          <div className="vel">
            <label>RITMO</label>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={st?.ritmo ?? 45}
              onChange={(e) => robot.send({ cmd: "ritmo", value: Number(e.target.value) })}
            />
            <output>{st?.ritmo ?? 45} %</output>
          </div>
        </div>
      </section>
      )}

      {/* Saiu daqui o card DESENVOLVIMENTO — PRÉVIA DO PADRÃO, REINICIAR e o
          multiplicador TURBO. Eram controles do SIMULADOR, feitos para quem
          estava escrevendo a cena: adiantar a paletização para conferir o
          padrão sem esperar o ciclo inteiro.

          Na TV da célula eles não têm o que fazer, e um deles é pior que
          inútil: REINICIAR ao lado de uma cena que espelha a célula real
          convida a ser apertado por quem acha que vai religar alguma coisa.
          Nada nesta tela comanda o mundo físico, e ela não deve sugerir que
          comanda. Quem for mexer na simulação usa a aba de desenvolvimento
          do navegador ou o `clp-falso`. */}

    </aside>
  );
}
