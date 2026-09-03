// ============================================================================
//  BARRA DE ABAS e o seletor de modo
//
//  A barra faz duas coisas que a tela sozinha não faria:
//
//  MOSTRA O QUE ESTÁ FORA DA VISTA. Cada aba carrega um ponto de alarme. Sem
//  ele, um inversor que entrasse em falha em modo manual ficaria escondido
//  atrás de uma aba fechada até alguém resolver clicar nela — e o que
//  esconde falha não é supervisório.
//
//  DIZ QUANTO FALTA. Em apresentação, a barrinha embaixo da aba ativa corre
//  até a próxima troca. Tela que muda sozinha sem avisar parece defeito; com
//  o aviso, quem está lendo sabe que tem cinco segundos, ou clica em MANUAL.
//
//  A barrinha é ANIMAÇÃO CSS, com `key` no ciclo. Um cronômetro em
//  JavaScript custaria dez renders por segundo do App inteiro — com uma cena
//  3D do lado — para desenhar um retângulo que o navegador anima sozinho.
// ============================================================================
import type { Aba, Abas } from "../lib/useAbas";
import { PERIODO_S } from "../lib/useAbas";

export interface ItemAba {
  id: Aba;
  rotulo: string;
  /** Ponto vermelho: este acionamento está em falha ou bloqueado. */
  alarme?: boolean;
  /** Sem dado do CLP — continua clicável, mas fica fora do rodízio. */
  vazia?: boolean;
}

export function BarraAbas({ abas, itens }: { abas: Abas; itens: ItemAba[] }) {
  return (
    <nav className="abas">
      {itens.map((it) => (
        <button
          key={it.id}
          className={"aba" + (abas.aba === it.id ? " ativa" : "")}
          onClick={() => abas.ir(it.id)}
        >
          {it.alarme && <i className="aba-alarme" />}
          {it.rotulo}
          {it.vazia && <em>sem dado</em>}
          {abas.aba === it.id && abas.modo === "apresentacao" && (
            <span
              key={abas.ciclo}
              className="aba-progresso"
              style={{ animationDuration: `${PERIODO_S}s` }}
            />
          )}
        </button>
      ))}

      <span className="spacer" />

      {/* O MODO é uma escolha, não um ajuste escondido: fica na mesma barra
          que ele governa, com as duas opções à vista. Um botão só, que
          alterna, obrigaria a ler o rótulo para descobrir se ele diz o estado
          atual ou o que vai acontecer ao clicar. */}
      <div className="modos" role="group" aria-label="modo de exibição">
        <button
          className={abas.modo === "apresentacao" ? "ativo" : ""}
          onClick={() => abas.setModo("apresentacao")}
          title={`As telas se alternam sozinhas a cada ${PERIODO_S} segundos`}
        >
          APRESENTAÇÃO
        </button>
        <button
          className={abas.modo === "manual" ? "ativo" : ""}
          onClick={() => abas.setModo("manual")}
          title="A tela só muda quando alguém clica"
        >
          MANUAL
        </button>
      </div>
    </nav>
  );
}
