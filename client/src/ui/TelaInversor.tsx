// ============================================================================
//  TELA DE UM ACIONAMENTO
//
//  Responde, nesta ordem, às perguntas de quem chega perto de uma esteira:
//
//   1. Ela está andando?            — a tarja de estado, legível de longe
//   2. Está andando como deveria?   — real contra comandado, lado a lado
//   3. Está andando com esforço?    — corrente, agora e nos últimos minutos
//   4. Se parou, por quê?           — bloqueio, falha, códigos do drive
//
//  Nada aqui COMANDA. Reconhecer falha e mudar setpoint mexem no mundo
//  físico, e esta tela é vista de longe, às vezes por quem só está passando.
//  Quem religa a esteira faz isso na IHM da máquina, de onde se enxerga a
//  esteira que vai andar.
// ============================================================================
import type { Inversor } from "../../../shared/types";
import { HIST_PONTOS } from "../lib/useHistorico";

/** Desvio da velocidade que já merece atenção, em fração do comandado.
 *  Comandado 1450 com real 1300 é 10 %: limite de corrente atuando, correia
 *  patinando ou carga travando. */
const DESVIO_ALERTA = 0.1;

const hex = (n: number) => "0x" + n.toString(16).toUpperCase().padStart(4, "0");

/** O estado em UMA frase, na ordem em que as causas importam: quem vê a
 *  esteira parada quer o motivo mais grave primeiro, não a lista toda.
 *
 *  `stoLiberado` e `aguardaReset` NÃO entram aqui. São os bits X3 e X4, hoje
 *  RESERVADOS pelo bloco 09: o CLP os deixa em zero porque o programa F ainda
 *  não exporta as tags de segurança, e zero ali significa "não sei", não
 *  "não". Ler `!stoLiberado` como causa faria todo acionamento sadio anunciar
 *  falta de permissão de giro — o campo que não sabe de nada seria o mais
 *  barulhento da tela. Quando as tags chegarem, as duas causas voltam para
 *  esta lista, acima de BLOQUEADO. */
function estado(inv: Inversor): { texto: string; classe: string } {
  if (inv.erro) return { texto: "EM FALHA", classe: "ruim" };
  if (inv.bloqueado) return { texto: "BLOQUEADO", classe: "atencao" };
  if (inv.ligado && inv.rpm > 5) return { texto: "GIRANDO", classe: "ok" };
  return { texto: "PARADO", classe: "" };
}

/** Um número grande com unidade. É o formato que se lê a três metros. */
function Medida({ rotulo, valor, unidade, alerta }: {
  rotulo: string; valor: string; unidade: string; alerta?: boolean;
}) {
  return (
    <div className={"medida" + (alerta ? " atencao" : "")}>
      <span className="medida-rot">{rotulo}</span>
      <b>{valor}<i>{unidade}</i></b>
    </div>
  );
}

/** Corrente dos últimos três minutos.
 *
 *  Sem eixo, sem grade, sem legenda: é a FORMA que informa — o degrau da
 *  partida, o patamar do regime, a queda da parada. Números exatos estão
 *  logo acima, em tamanho grande; repeti-los aqui em miúdo só tiraria espaço
 *  do desenho. */
function Corrente({ serie }: { serie: number[] }) {
  const L = 300, A = 64;
  // Escala mínima de 1 A para a linha do zero não virar ruído amplificado:
  // sem piso, uma esteira parada desenharia montanhas de 0,01 A.
  const teto = Math.max(1, ...serie) * 1.15;
  const n = serie.length;

  // A SÉRIE OCUPA A LARGURA TODA, sempre — o eixo mede o que existe, e o
  // título diz quanto é.
  //
  // A primeira versão ancorava o "agora" na direita e reservava as três
  // horas... os três minutos inteiros de eixo, então nos primeiros instantes
  // desenhava uma curva espremida num canto com quatro quintos do painel em
  // branco. Numa TV vista de longe isso não se lê como "a janela ainda está
  // enchendo", se lê como gráfico quebrado — e por causa da recarga
  // automática, que zera a série sem ninguém por perto, esse é um estado
  // frequente, não um detalhe dos primeiros minutos de vida da página.
  const passo = n > 1 ? L / (n - 1) : 0;
  const pontos = serie
    .map((v, i) => `${(i * passo).toFixed(1)},${(A - (v / teto) * A).toFixed(1)}`)
    .join(" ");

  // Uma amostra por segundo (ver useHistorico), então o comprimento da série
  // É o intervalo. Em segundos até dois minutos, depois em minutos cheios —
  // arredondar para baixo garante que o rótulo nunca prometa mais história
  // do que o desenho tem.
  const janela = n >= HIST_PONTOS ? "ÚLTIMOS 3 MINUTOS"
    : n > 119 ? `ÚLTIMOS ${Math.floor(n / 60)} MINUTOS`
    : `ÚLTIMOS ${n} SEGUNDOS`;

  return (
    <div className="grafico">
      <div className="grafico-topo">
        <span>CORRENTE · {janela}</span>
        <span className="grafico-teto">{teto.toFixed(2)} A</span>
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" role="img"
           aria-label={`corrente, ${janela.toLowerCase()}`}>
        {n > 1 && (
          <>
            <polyline className="grafico-area"
              points={`0,${A} ${pontos} ${L},${A}`} />
            <polyline className="grafico-linha" points={pontos} />
          </>
        )}
      </svg>
    </div>
  );
}

export function TelaInversor({ nome, inv, serie }: {
  nome: string;
  inv: Inversor | null;
  serie: number[];
}) {
  // AUSENTE E EXPLÍCITO, o mesmo tratamento do card de produção: um inversor
  // com todos os campos zerados seria lido como esteira parada, e é outra
  // coisa — é a chamada do bloco 09 que ainda não está no Main do CLP.
  if (!inv) {
    return (
      <section className="card tela-inv tela-inv-vazia">
        <div className="card-title">{nome}</div>
        <div className="wip wip-grande">
          <div className="wip-conteudo" aria-hidden="true">
            <div className="wip-linha"><span>VELOCIDADE</span><b>—</b></div>
            <div className="wip-linha"><span>CORRENTE</span><b>—</b></div>
            <div className="wip-linha"><span>POTÊNCIA</span><b>—</b></div>
            <div className="wip-linha"><span>TORQUE</span><b>—</b></div>
          </div>
          <span className="wip-selo">AGUARDANDO O CLP</span>
        </div>
        <p className="tela-inv-nota">
          O bloco <b>09 - SUPERVISORIO INVERSORES</b> ainda não está publicando
          para este acionamento. A tela sai daqui sozinha quando a chamada
          entrar no <b>Main [OB1]</b>.
        </p>
      </section>
    );
  }

  const e = estado(inv);
  const cmd = inv.rpmComandado;
  const desvio = cmd > 0 ? Math.abs(inv.rpm - cmd) / cmd : 0;
  const foraDeFaixa = cmd > 0 && desvio > DESVIO_ALERTA;

  return (
    <section className="card tela-inv">
      <div className="tela-inv-topo">
        <h2>{nome}</h2>
        <span className={"pill " + (e.classe === "ok" ? "ok" : e.classe === "ruim" ? "off" : e.classe === "atencao" ? "sim" : "")}>
          {e.texto}
        </span>
      </div>

      <div className="medidas">
        <Medida rotulo="VELOCIDADE" valor={String(inv.rpm)} unidade="rpm" alerta={foraDeFaixa} />
        <Medida rotulo="CORRENTE" valor={inv.corrente.toFixed(2)} unidade="A" />
        <Medida rotulo="POTÊNCIA" valor={String(inv.potencia)} unidade="W" />
        <Medida rotulo="TORQUE" valor={inv.torque.toFixed(2)} unidade="Nm" />
      </div>

      {/* REAL CONTRA COMANDADO. As duas juntas porque a diferença é que
          diagnostica: o setpoint sozinho não prova nada, e a velocidade real
          sozinha não diz se é a que se pediu. */}
      <div className="setpoint">
        <div className="setpoint-rot">
          <span>REAL vs COMANDADO</span>
          <span className={foraDeFaixa ? "atencao" : ""}>
            {cmd > 0
              ? `${inv.rpm} / ${cmd} rpm · ${(desvio * 100).toFixed(0)} % de desvio`
              : "sem comando de velocidade"}
          </span>
        </div>
        <div className="barra">
          <div className="barra-real"
               style={{ width: `${Math.min(100, cmd > 0 ? (inv.rpm / cmd) * 100 : 0)}%` }} />
          {cmd > 0 && <div className="barra-alvo" />}
        </div>
      </div>

      <Corrente serie={serie} />

      <div className="tela-inv-pe">
        <Bit rotulo="HABILITADO" ligado={inv.ligado} bom />
        <Bit rotulo="BLOQUEIO" ligado={inv.bloqueado} />
        <Bit rotulo="FALHA" ligado={inv.erro} />
        {/* SEM linha de segurança, e a ausência é a informação correta. Os
            bits X3/X4 chegam em zero porque o bloco 09 os reserva até o
            programa F exportar as tags — e um campo "SEGURANÇA: NÃO LIBERADA"
            que na verdade quer dizer "não sei" é pior do que campo nenhum:
            alguém decide se chega perto da esteira olhando para ele. O dia em
            que os bits tiverem fonte, entra aqui um <Bit rotulo="STO
            LIBERADO" ligado={inv.stoLiberado} bom />. */}
        <span className="cod">STATUS {hex(inv.status)}</span>
        <span className="cod">DIAG {hex(inv.diagId)}</span>
      </div>
    </section>
  );
}

/** Um bit nomeado, com cor SÓ quando ela significa algo.
 *
 *  `bom` diz para que lado o bit é boa notícia: HABILITADO ligado fica verde,
 *  BLOQUEIO ligado fica vermelho. Desligado, os dois ficam cinza — e é de
 *  propósito. Pintar HABILITADO de vermelho quando a esteira está parada
 *  transformaria o estado normal de uma célula ociosa num alarme, e alarme
 *  que acende sem motivo ensina a ignorar alarme. */
function Bit({ rotulo, ligado, bom }: { rotulo: string; ligado: boolean; bom?: boolean }) {
  return (
    <span className={"bit" + (ligado ? (bom ? " on" : " ruim") : "")}>
      <i /> {rotulo}
    </span>
  );
}
