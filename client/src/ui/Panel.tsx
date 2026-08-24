// ============================================================================
//  Painel lateral: o que o operador precisa decidir olhando de longe.
//
//  Só três blocos de leitura — PRODUÇÃO, ROBÔ e SEGURANÇA. Garra, ar e
//  paletização saíram: eram detalhe de manutenção competindo por atenção
//  com o que faz alguém agir. O resto são controles, não indicadores.
// ============================================================================
import type { RobotLink } from "../lib/useRobot";

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


export function Panel({ robot }: { robot: RobotLink }) {
  const st = robot.state;
  const moving = Boolean(st && st.running && st.speed > 2);
  const trocando = st?.phase === -1;
  const prod = st?.producao ?? null;

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

      {/* ============ INDICADORES DE PRODUÇÃO ============
          Com dado do CLP, mostra. Sem dado, fica desfocado com o selo —
          porque zero e "não sei" são coisas diferentes, e um card com zeros
          o operador lê como produção parada. Quem decide é o servidor, que
          manda `producao: null` enquanto o FB 08 não estiver no CLP. */}
      <section className="card">
        <div className="card-title">
          INDICADORES DE PRODUÇÃO
          {prod ? ` · TURNO ${prod.turno === 0 ? "—" : prod.turno}` : ""}
        </div>
        {prod ? (
          <div className="prod">
            <div className="prod-par">
              <div className="prod-caixa ok">
                <span>PEÇAS OK</span>
                <b>{prod.ok}</b>
              </div>
              <div className={"prod-caixa" + (prod.nok > 0 ? " nok" : "")}>
                <span>NÃO OK</span>
                <b>{prod.nok}</b>
              </div>
            </div>
            <div className="sinais">
              <Sinal rotulo="PEÇAS / HORA" valor={String(prod.porHora)} />
              <Sinal
                rotulo="TEMPO DE TURNO"
                valor={`${Math.floor(prod.minutos / 60)}h${String(prod.minutos % 60).padStart(2, "0")}`}
              />
              {/* Refugo em vez de "% OK": o número que importa é o que dói. */}
              <Sinal
                rotulo="REFUGO"
                valor={
                  prod.ok + prod.nok === 0
                    ? "—"
                    : `${((prod.nok * 100) / (prod.ok + prod.nok)).toFixed(1)} %`
                }
                alerta={prod.nok * 20 > prod.ok + prod.nok ? "atencao" : undefined}
              />
              {/* SUBCONJUNTO do NÃO OK, não uma terceira categoria: destas
                  reprovadas, quantas por ausência de veredito. Sobe sozinho =
                  problema na balança, não nas caixas. */}
              <Sinal
                rotulo="SEM PESAGEM"
                valor={String(prod.semVeredito)}
                alerta={prod.semVeredito > 0 ? "atencao" : undefined}
              />
              <Sinal rotulo="TURNO ANTERIOR" valor={`${prod.okAnterior} OK`} />
              <Sinal rotulo="ACUMULADO" valor={`${prod.okTotal} OK`} />
            </div>
          </div>
        ) : (
          <div className="wip">
            <div className="wip-conteudo" aria-hidden="true">
              <div className="wip-linha"><span>PEÇAS OK</span><b>—</b></div>
              <div className="wip-linha"><span>NÃO OK</span><b>—</b></div>
              <div className="wip-linha"><span>PEÇAS / HORA</span><b>—</b></div>
              <div className="wip-linha"><span>REFUGO</span><b>—</b></div>
            </div>
            <span className="wip-selo">AGUARDANDO O CLP</span>
          </div>
        )}
      </section>

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

      {/* ============ SEGURANÇA: por que não dá para religar? ============ */}
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
            <Sinal
              rotulo="PORTAS"
              valor={st.status.portas ? "FECHADAS" : "ABERTA"}
              alerta={st.status.portas ? undefined : "ruim"}
            />
            <Sinal
              rotulo="BARREIRAS"
              valor={st.status.barreiras ? "LIVRES" : "INTERROMPIDA"}
              alerta={st.status.barreiras ? undefined : "ruim"}
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

      <section className="card">
        <div className="card-title">DESENVOLVIMENTO</div>
        <div className="controls">
          <div className="dev-row">
            <button disabled={!robot.connected} onClick={() => robot.send({ cmd: "preview" })}>
              PRÉVIA DO PADRÃO
            </button>
            <button disabled={!robot.connected} onClick={() => robot.send({ cmd: "reset" })}>
              REINICIAR
            </button>
          </div>
          <div className="vel">
            <label>TURBO</label>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={st?.turbo ?? 1}
              onChange={(e) => robot.send({ cmd: "turbo", value: Number(e.target.value) })}
            />
            <output>{st?.turbo ?? 1}×</output>
          </div>
        </div>
      </section>
    </aside>
  );
}
