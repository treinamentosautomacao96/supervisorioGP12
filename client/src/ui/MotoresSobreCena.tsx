// ============================================================================
//  MOTORES SOBRE A CENA
//
//  As esteiras têm tela própria (a aba ENTRADA e a aba BALANÇA), com corrente
//  no tempo, setpoint contra real e códigos do drive. Só que na TV da célula
//  ninguém entra nelas: o rodízio é entre o dashboard do SYNC e a aba
//  PROCESSO, e quem passa em frente ao monitor não vai clicar em nada.
//
//  Então o mínimo de cada acionamento sobe para cá — está andando, a quantas,
//  puxando quanto. As abas continuam existindo para quem for diagnosticar;
//  esta tabela existe para quem só passa.
//
//  NÃO repete o que a tela do inversor faz melhor: sem torque, sem potência,
//  sem código de diagnóstico, sem histórico. Quatro números por linha é o que
//  se lê de três metros sem parar de olhar o robô.
// ============================================================================
import type { Inversor, Inversores } from "../../../shared/types";

/** O mesmo desvio que a tela do inversor trata como digno de atenção: 10 %
 *  entre o comandado e o real é limite de corrente, correia patinando ou
 *  carga travando. Repetido aqui de propósito — se um dia mudar lá, a
 *  divergência entre as duas telas é o sintoma, e é visível. */
const DESVIO_ALERTA = 0.1;

/** Abaixo disto a rotacao vira 0 na tela.
 *
 *  Esteira parada nao marca zero redondo: o drive devolve 2, 3, 4 rpm de
 *  ruido de medicao, e na TV isso aparece como maquina andando devagar --
 *  que e' um defeito bem mais alarmante que parada. Como `estado()` ja
 *  trata `rpm > 5` como GIRANDO, usar o MESMO valor aqui e' o que impede
 *  a tabela de dizer PARADO e mostrar rotacao na mesma linha. */
const RPM_PARADO = 5;

/** Uma palavra, na ordem em que as causas importam. É a mesma escada da
 *  `TelaInversor`, e pelo mesmo motivo `stoLiberado`/`aguardaReset` ficam de
 *  fora: hoje o bloco 09 os deixa em zero, e zero ali é "não sei", não "não".
 *  Lidos como causa, todo acionamento sadio anunciaria falta de permissão. */
function estado(inv: Inversor): { texto: string; classe: string } {
  if (inv.erro) return { texto: "FALHA", classe: "ruim" };
  if (inv.bloqueado) return { texto: "BLOQUEADO", classe: "atencao" };
  if (inv.ligado && inv.rpm > RPM_PARADO) return { texto: "GIRANDO", classe: "ok" };
  return { texto: "PARADO", classe: "" };
}

function Linha({ nome, inv }: { nome: string; inv: Inversor | null }) {
  // SEM DADO não é PARADO. O CLP manda `null` enquanto o FC 09 não responde
  // pelo acionamento, e desenhar zero ali diria que a esteira está parada
  // quando a verdade é que ninguém sabe.
  if (!inv) {
    return (
      <tr className="motores-sem-dado">
        <th>{nome}</th>
        <td colSpan={3}>SEM DADO</td>
      </tr>
    );
  }

  const e = estado(inv);
  const desvio =
    inv.rpmComandado > 0 &&
    Math.abs(inv.rpm - inv.rpmComandado) / inv.rpmComandado > DESVIO_ALERTA;

  return (
    <tr>
      <th>{nome}</th>
      <td className={"motores-estado " + e.classe}>{e.texto}</td>
      {/* SÓ O VALOR MEDIDO. O comandado chegou a aparecer ao lado quando os
          dois divergiam, e a leitura de longe ficava pior, não melhor: dois
          números na mesma célula viram uma conta a fazer, e esta tabela é
          para quem passa em frente ao monitor.

          A divergência continua dita — pela COR. Âmbar aqui significa
          "comandado e real não batem", e quem quiser o quanto abre a aba do
          acionamento, que mostra os dois lado a lado com a corrente no
          tempo. */}
      <td className={"motores-num" + (desvio ? " atencao" : "")}>
        {inv.rpm > RPM_PARADO ? Math.round(inv.rpm) : 0}
        <u>rpm</u>
      </td>
      <td className="motores-num">
        {inv.corrente.toFixed(1)}
        <u>A</u>
      </td>
    </tr>
  );
}

/** `pointer-events: none` no CSS é obrigatório, como era no placar que ficava
 *  aqui: sem isso a tabela engole o arraste do mouse e a órbita da câmera
 *  morre neste canto da tela. */
export function MotoresSobreCena({ inv }: { inv: Inversores | undefined }) {
  if (!inv) return null;
  return (
    <table className="motores">
      {/* Os titulos existem porque "rpm" e "A" dizem a UNIDADE, nao o que
          esta' sendo medido -- e corrente de motor nao e' obvia para todo
          mundo que passa em frente a TV. A primeira coluna nao tem titulo:
          ela e' o nome da esteira, e nomear a coluna dos nomes e' redundancia
          que so' ocupa altura. */}
      <thead>
        <tr>
          <td />
          <th>ESTADO</th>
          <th>ROTAÇÃO</th>
          <th>CORRENTE</th>
        </tr>
      </thead>
      <tbody>
        <Linha nome="ESTEIRA DE ENTRADA" inv={inv.entrada} />
        <Linha nome="ESTEIRA DA BALANÇA" inv={inv.balanca} />
      </tbody>
    </table>
  );
}
