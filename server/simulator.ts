// ============================================================================
//  Simulador do GP12 paletizando — a FONTE DE DADOS do supervisório.
//
//  O ciclo: pega a caixa de ventilador na esteira (à frente), gira a base
//  para o lado e deposita num dos DOIS paletes (S = ±90°), alternando entre
//  eles, 2x2 por camada, 3 camadas. Cheios os dois, troca de paletes e
//  recomeça.
//
//  Diferente da demo de poses fixas, aqui cada posição da pilha vira ângulos
//  de junta por CINEMÁTICA INVERSA — é o que um programa de paletização faz
//  no pendant com shift de posição.
//
//  A simulação roda NO SERVIDOR: todos os navegadores veem o MESMO robô.
// ============================================================================
import { EventEmitter } from "node:events";
import type { PlacedBox, RobotState, Vec3 } from "../shared/types.js";

// Dimensões do desenho cotado do GP12 (mm)
export const GEO = {
  S_OFF: 155,   // offset horizontal do ombro
  L_H: 450,     // altura do eixo L
  L1: 614,      // braço inferior
  RISER: 200,   // elevação do cotovelo
  L2: 640,      // antebraço até o punho
  TOOL: 130,    // punho -> TCP
} as const;

// Velocidades máximas de junta do datasheet (graus/s)
export const VMAX = { S: 260, L: 230, U: 260 } as const;
export const JACC = 260;          // graus/s² na junta que governa
const TICK_MS = 20;        // simulação a 50 Hz

// ------------------------------------------------------------------ célula
// Caixa de ventilador de mesa Turbo 40 cm: vai EM PÉ no palete, de lombada,
// como livros — o padrão da foto do palete real. A ventosa pega pela borda
// superior (500 x 150).
export const BOX = { w: 500, d: 150, h: 570 } as const;

// O robô fica num PEDESTAL de 800 mm: o CATAVENTO poe lombadas a ~1410 mm de
// raio, e a 2ª camada termina a 1290 mm de altura. No chão — e até com 400 de
// pedestal — a cinemática não fecha; a 800 fecha com margem de ~20 mm no
// pior slot. Célula real desse padrão com GP12 é assim: robô alto.
export const PED = 800;

// A entrada: esteira de correia (um pouco maior que a caixa) que alimenta a
// BALANÇA TOLEDO de roletes. A caixa para sobre os roletes, é pesada, e só
// então o robô pega — a balança é quem libera a pega.
export const PICK = { r: 1150, top: 550 } as const;   // centro da balança
export const FEED = {
  start: 3550,          // a caixa entra ANTES da seladora e a atravessa
  sealExit: PICK.r + 980, // onde a seladora termina e a esteira começa
  vel: 450,             // mm/s da correia
  settle: 0.9,          // s de estabilização da pesagem
} as const;
export const PALLET = {
  // 1150 mm do eixo do robô ao centro do palete: afastado o bastante para o
  // operador e a empilhadeira circularem sem esbarrar na base, e ainda dentro
  // do alcance do GP12 no pedestal de 800.
  size: 1200, top: 150, r: 1150,
  layers: 2,                      // catavento de 16 por camada, 2 camadas = 32
} as const;

// Saída do palete na empilhadeira, e a troca que a contém. A troca tem de
// durar MAIS do que a saída: `placed` é limpo no fim dela, e se fosse antes a
// pilha desapareceria no meio do caminho, deixando o palete viajar vazio.
// Mesmo valor de saída da fonte real (MqttSource.SAIDA_S), de propósito: o
// mesmo movimento nas duas fontes.
const SAIDA_S = 5.0;
const TROCA_S = 6.0;

// A calha de DESCARTE: peça em posição sem o OK da balança = reprovada, e o
// robô a descarta aqui — regra confirmada pelo autor da célula.
export const DESCARTE = { s: 40, r: 1120, top: 650 } as const;

// Fuso da planta. Os turnos são da fábrica, e o servidor pode estar em
// qualquer lugar — na nuvem ele roda em UTC.
const FUSO_FABRICA = "America/Sao_Paulo";

/** Formatador da hora da fábrica, criado UMA vez.
 *
 *  Era criado dentro de `indicadores()`, a cada tick — 50 vezes por segundo.
 *  Um `Intl.DateTimeFormat` carrega um formatador ICU: memória NATIVA, fora do
 *  heap do V8. O invólucro JavaScript é minúsculo, então o coletor não sente
 *  pressão e quase não roda; enquanto isso a parte nativa cresce sem que
 *  nenhum contador do processo a mostre (heapUsed parado, external parado,
 *  RSS subindo ~1,2 MB/s).
 *
 *  Foi o que derrubava a instância do Render a cada ~10 min em 21-22/09/2026,
 *  com heap de 25 MB num RSS de 476. Três correções de heap e de socket não
 *  mudaram nada — não havia o que recolher no heap. */
const FORMATO_HORA_FABRICA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_FABRICA, hour: "2-digit", minute: "2-digit", hour12: false,
});

const PER_LAYER = 16;
export const PER_PALLET = PER_LAYER * PALLET.layers;              // 32
export const TOTAL = PER_PALLET * 2;                              // 64

export const PHASES = [
  "APROX. PEGA",
  "PEGA",
  "SOBE",
  "GIRO AO PALETE",
  "APROX. POSIÇÃO",
  "DEPOSITA",
  "RECUA",
] as const;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// ----------------------------------------------------------------------------
//  Cinemática
// ----------------------------------------------------------------------------

// Altura do ombro em relação ao CHÃO: a do desenho cotado + o pedestal.
const SHOULDER_Y = GEO.L_H + PED;

/** TCP em coordenadas de mundo (y para cima, chão = 0), a partir das juntas. */
export function fkTcp(j: [number, number, number]): Vec3 {
  const { S_OFF, L1, RISER, L2, TOOL } = GEO;
  const sL = Math.sin(rad(j[1])), cL = Math.cos(rad(j[1]));
  const sU = Math.sin(rad(j[2])), cU = Math.cos(rad(j[2]));
  const r1 = S_OFF + L1 * sL, y1 = SHOULDER_Y + L1 * cL;
  const r3 = r1 + RISER * sU + L2 * cU;
  const y3 = y1 + RISER * cU - L2 * sU;
  const cS = Math.cos(rad(j[0])), sS = Math.sin(rad(j[0]));
  return { x: r3 * cS, y: y3 - TOOL, z: -r3 * sS };
}

// O conjunto elevação+antebraço é um elo rígido: comprimento M no ângulo
// (PHI - U) a partir da horizontal. Vira um 2-elos clássico.
const M = Math.hypot(GEO.RISER, GEO.L2);
const PHI = Math.atan2(GEO.RISER, GEO.L2);

/**
 * Cinemática inversa no plano do braço: dado o TCP (raio, altura), devolve
 * [L, U] com o cotovelo POR CIMA — a configuração de paletização, que mantém
 * o cotovelo longe da pilha. Alvo fora do alcance é trazido para a borda.
 */
export function ikLU(r: number, y: number): [number, number] {
  const wr = r, wy = y + GEO.TOOL;                 // alvo do punho
  let dr = wr - GEO.S_OFF, dy = wy - SHOULDER_Y;
  let D = Math.hypot(dr, dy);
  const dMax = GEO.L1 + M - 1, dMin = Math.abs(GEO.L1 - M) + 1;
  if (D > dMax || D < dMin) {
    const k = Math.min(dMax, Math.max(dMin, D)) / (D || 1);
    dr *= k; dy *= k;
    D = Math.hypot(dr, dy);
  }
  const a1 = Math.atan2(dy, dr);
  const cosA = (GEO.L1 * GEO.L1 + D * D - M * M) / (2 * GEO.L1 * D);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const th1 = a1 + alpha;                           // cotovelo por cima
  const er = GEO.S_OFF + GEO.L1 * Math.cos(th1);
  const ey = SHOULDER_Y + GEO.L1 * Math.sin(th1);
  const th2 = Math.atan2(SHOULDER_Y + dy - ey, GEO.S_OFF + dr - er);
  return [90 - deg(th1), deg(PHI - th2)];
}

// ----------------------------------------------------------------------------
//  A pilha: onde cada caixa vai parar
// ----------------------------------------------------------------------------
interface Slot { s: number; r: number; placeY: number; center: Vec3 }

/** Um passo do padrão: dado i (0..3, a lombada dentro do grupo), devolve a
 *  posição local no palete e a orientação da caixa. */
type Passo = (i: number) => { x: number; z: number; rot: number };

// ============================================================================
//  O PADRÃO, palete a palete, camada a camada — JÁ EM ORDEM DE EXECUÇÃO.
//  Cada linha é um grupo de 4 lombadas (uma "seta" do desenho do operador).
//  A e B NÃO são espelhos automáticos: cada um foi conferido na cena e
//  corrigido pelo operador. Mudar o padrão = editar estas tabelas, nada mais.
// ============================================================================

// PALETE A · camada de BAIXO. A ordem entre 2 e 3 foi trocada e DESFEITA a
// pedido do operador: o grupo do fundo (z = +300) volta a sair antes do que
// fica do lado do robô (z = -300). Fica o registro para não trocar de novo.
const TAB_A0: Passo[] = [
  (i) => ({ x: -300,           z: -475 + i * 150, rot: 0  }),   // 1: coluna ↓
  (i) => ({ x: -475 + i * 150, z: 300,            rot: 90 }),   // 2: borda → centro
  (i) => ({ x: 25 + i * 150,   z: -300,           rot: 90 }),   // 3: centro → borda
  (i) => ({ x: 300,            z: 25 + i * 150,   rot: 0  }),   // 4: coluna ↓
];

// PALETE A · camada de CIMA (conferida: 1º e 4º com sentido invertido)
const TAB_A1: Passo[] = [
  (i) => ({ x: -475 + i * 150, z: -300,           rot: 90 }),   // 1
  (i) => ({ x: 300,            z: -475 + i * 150, rot: 0  }),   // 2
  (i) => ({ x: -300,           z: 25 + i * 150,   rot: 0  }),   // 3
  (i) => ({ x: 25 + i * 150,   z: 300,            rot: 90 }),   // 4
];

// PALETE B · camada de BAIXO — correções do operador: o grupo que saía em 2º
// abre a sequência; e a ordem entre 2 e 3 foi trocada, como no palete A.
const TAB_B0: Passo[] = [
  (i) => ({ x: -475 + i * 150, z: 300,            rot: 90 }),   // 1
  (i) => ({ x: 300,            z: 475 - i * 150,  rot: 0  }),   // 2 (invertido)
  (i) => ({ x: -300,           z: -25 - i * 150,  rot: 0  }),   // 3 (invertido)
  (i) => ({ x: 25 + i * 150,   z: -300,           rot: 90 }),   // 4
];

// PALETE B · camada de CIMA — ordem e sentidos conferidos pelo operador
const TAB_B1: Passo[] = [
  (i) => ({ x: -300,           z: 475 - i * 150,  rot: 0  }),   // 1 (invertido)
  (i) => ({ x: -475 + i * 150, z: -300,           rot: 90 }),   // 2
  (i) => ({ x: 25 + i * 150,   z: 300,            rot: 90 }),   // 3
  (i) => ({ x: 300,            z: -25 - i * 150,  rot: 0  }),   // 4 (invertido)
];

export function slot(side: 1 | -1, idx: number): Slot & { rot: number } {
  const layer = Math.floor(idx / PER_LAYER);
  const k = idx % PER_LAYER;
  const p = Math.floor(k / 4);       // posição na SEQUÊNCIA de execução
  const i = k % 4;

  const tabela = side === 1
    ? (layer === 0 ? TAB_A0 : TAB_A1)
    : (layer === 0 ? TAB_B0 : TAB_B1);
  const { x, z, rot } = tabela[p](i);

  const zw = -side * PALLET.r + z;
  const s = deg(Math.atan2(-zw, x));
  const r = Math.hypot(x, zw);
  // Ventosas pegam pela borda superior: o TCP é o plano do topo da caixa.
  const placeY = PALLET.top + (layer + 1) * BOX.h;
  const center = { x, y: PALLET.top + layer * BOX.h + BOX.h / 2, z: zw };
  return { s, r, placeY, center, rot };
}

// ----------------------------------------------------------------------------
//  Roteiro de uma caixa: waypoints em junta, via IK
// ----------------------------------------------------------------------------
export interface Waypoint {
  j: [number, number, number];
  /** Presente = movimento LINEAR (MOVL): linha reta cartesiana até (r, y)
   *  com S fixo, em vez de arco de junta. É como o robô real entra na pilha. */
  lin?: { s: number; r: number; y: number };
  phase: number;
  grip?: "fecha" | "abre";
  dwell: number;
}

const VEL_LIN = 500;               // mm/s do MOVL a 100% de ritmo

/** Altura máxima que o TCP alcança num dado raio — o teto físico do punho. */
export function tcpMax(r: number): number {
  const dr = Math.max(0, r - GEO.S_OFF);
  const alc = GEO.L1 + M - 1;
  if (dr >= alc) return SHOULDER_Y - GEO.TOOL;
  return SHOULDER_Y + Math.sqrt(alc * alc - dr * dr) - GEO.TOOL;
}

// O palete A é montado INTEIRO antes do B — é assim que a célula real opera:
// palete cheio sai de empilhadeira enquanto o robô começa o outro lado.
function sideOf(boxIdx: number): 1 | -1 {
  return boxIdx < PER_PALLET ? 1 : -1;
}

export function route(boxIdx: number): Waypoint[] {
  const side = sideOf(boxIdx);
  const sl = slot(side, boxIdx % PER_PALLET);
  const wp = (phase: number, s: number, r: number, y: number,
              grip?: "fecha" | "abre", dwell = 0.3): Waypoint =>
    ({ j: [s, ...ikLU(r, y)], phase, grip, dwell });
  const wpL = (phase: number, s: number, r: number, y: number,
               grip?: "fecha" | "abre", dwell = 0.3): Waypoint =>
    ({ j: [s, ...ikLU(r, y)], lin: { s, r, y }, phase, grip, dwell });

  // Aproximação DIRETO ACIMA do slot, na maior altura que o punho alcança
  // naquele raio (limitada a +560, uma caixa de folga). A descida final é
  // LINEAR e VERTICAL — nunca varre por dentro da camada. Nos slots mais
  // distantes o teto físico é mais baixo; a vertical continua, só mais curta.
  const hAprox = Math.max(sl.placeY + 120,
    Math.min(sl.placeY + 560, tcpMax(sl.r) - 25));

  return [
    wp(0, 0, PICK.r, PICK.top + BOX.h + 250),
    wpL(1, 0, PICK.r, PICK.top + BOX.h, "fecha", 0.45),  // desce RETO na balança
    wpL(2, 0, PICK.r, PICK.top + BOX.h + 320),           // sobe RETO
    wp(3, sl.s, 700, 1550),                    // transporte: alto, por cima da pilha
    wp(4, sl.s, sl.r, hAprox),                 // em cima do slot
    wpL(5, sl.s, sl.r, sl.placeY, "abre", 0.45),         // desce RETO no slot
    wpL(6, sl.s, sl.r, hAprox),                          // sobe RETO
  ];
}

/** Roteiro da caixa REPROVADA: mesma pega, destino a calha de descarte. */
export function routeDescarte(): Waypoint[] {
  const wp = (phase: number, s: number, r: number, y: number,
              grip?: "fecha" | "abre", dwell = 0.3): Waypoint =>
    ({ j: [s, ...ikLU(r, y)], phase, grip, dwell });
  const wpL = (phase: number, s: number, r: number, y: number,
               grip?: "fecha" | "abre", dwell = 0.3): Waypoint =>
    ({ j: [s, ...ikLU(r, y)], lin: { s, r, y }, phase, grip, dwell });
  const alto = DESCARTE.top + BOX.h + 300;

  return [
    wp(0, 0, PICK.r, PICK.top + BOX.h + 250),
    wpL(1, 0, PICK.r, PICK.top + BOX.h, "fecha", 0.45),
    wpL(2, 0, PICK.r, PICK.top + BOX.h + 320),
    wp(3, DESCARTE.s, 700, 1550),
    wp(4, DESCARTE.s, DESCARTE.r, alto),
    wpL(5, DESCARTE.s, DESCARTE.r, DESCARTE.top + BOX.h, "abre", 0.3),
    wpL(6, DESCARTE.s, DESCARTE.r, alto),
  ];
}

// ----------------------------------------------------------------------------
//  O simulador
// ----------------------------------------------------------------------------
export class Gp12Simulator extends EventEmitter {
  private j: [number, number, number] = [0, -5, -50];
  private jFrom: [number, number, number] = [...this.j];
  private boxIdx = 0;
  private wps: Waypoint[] = route(0);
  private wp = 0;
  private prog = 0;
  private jv = 0;
  private dwell = 0;
  private trocando = false;      // paletes cheios, aguardando troca
  private okSim = 0;             // depósitos desde que o simulador subiu
  private carrying = false;
  // ---- entrada: esteira + balança ----
  private feedX: number | null = null;   // posição da caixa que chega
  private boxReady = false;              // balança liberou a pega
  private pesagem = 0;                   // s acumulados sobre os roletes
  private pesoAlvo = 0;                  // peso real desta caixa (kg)
  private pesoLido = 0;                  // leitura atual do display (kg)
  private placed: PlacedBox[] = [];
  private running = true;
  private ritmo = 45;
  private turbo = 1;             // dev: multiplicador do TEMPO simulado
  private tcpPrev: Vec3 | null = null;
  // origem cartesiana do trecho atual — de onde o MOVL parte
  private cartDe: { r: number; y: number } = { r: 0, y: 0 };
  private tcpSpeed = 0;
  private timer: NodeJS.Timeout;

  /** Posição cartesiana atual do TCP no plano do braço (raio, altura). */
  // ==========================================================================
  //  INVERSORES SIMULADOS
  //
  //  Números INVENTADOS, como todo o resto deste arquivo — servem para a tela
  //  existir antes de o bloco 09 entrar no CLP, e para conferir a aba sem
  //  depender da fábrica. Na fonte real nada disto é usado.
  //
  //  Vale a pena serem dinâmicos e não constantes: o mostrador de velocidade
  //  precisa ser visto RAMPANDO, e a corrente parada esconderia justamente o
  //  defeito que a tela existe para mostrar. A rampa é atraso de primeira
  //  ordem, e o passo é normalizado pelo dt para não depender do quadro.
  // ==========================================================================
  private rpmEntrada = 0;
  private rpmBalanca = 0;
  private relogioInv = 0;

  private giraInversores(dt: number) {
    this.relogioInv += dt;
    // A esteira de ENTRADA anda quando há caixa a caminho da balança; a da
    // BALANÇA, só enquanto a caixa está sendo transferida. Amarrar aos
    // estados que já existem é mais barato do que inventar um ciclo próprio,
    // e faz a tela concordar com a cena ao lado.
    // A de ENTRADA anda enquanto a caixa viaja; a da BALANÇA entra no trecho
    // final e para junto — é assim que duas esteiras em série se comportam,
    // a de jusante partindo quando a peça a alcança. Depois que a pesagem
    // conclui, as duas ficam paradas com a caixa em cima esperando o robô.
    const emViagem = this.running && !this.trocando
      && this.feedX !== null && !this.boxReady;
    const alcancouBalanca = emViagem && this.feedX! < PICK.r + 420;
    const alvoEntrada = emViagem ? 1450 : 0;
    const alvoBalanca = alcancouBalanca ? 900 : 0;
    const k = 1 - Math.exp(-dt * 2.5);
    this.rpmEntrada += (alvoEntrada - this.rpmEntrada) * k;
    this.rpmBalanca += (alvoBalanca - this.rpmBalanca) * k;
  }

  /** Corrente plausível para a rotação: uma parcela de vazio mais uma de
   *  carga, com uma ondulação lenta em cima — motor em regime treme. */
  private inversorSim(rpm: number, alvo: number, fase: number) {
    const girando = rpm > 5;
    const carga = rpm / 1450;
    const corrente = girando
      ? 0.42 + carga * 0.55 + Math.sin(this.relogioInv * 1.7 + fase) * 0.04
      : 0;
    return {
      ligado: girando,
      bloqueado: false,
      erro: false,
      // RESERVADOS, como no CLP: o bloco 09 deixa X3/X4 em zero até o
      // programa F exportar as tags. Simular "liberado" aqui faria o gêmeo
      // ser mais otimista do que o campo, e um dia alguém compararia os dois.
      stoLiberado: false,
      aguardaReset: false,
      rpm: Math.round(rpm),
      rpmComandado: alvo,
      corrente: Math.round(corrente * 100) / 100,
      torque: Math.round(carga * 1.35 * 100) / 100,
      potencia: Math.round(corrente * 220 * 0.8),
      status: 0,
      diagId: 0,
    };
  }

  private tcpRY(): { r: number; y: number } {
    const t = fkTcp(this.j);
    return { r: Math.hypot(t.x, t.z), y: t.y };
  }

  constructor() {
    super();
    this.cartDe = this.tcpRY();
    this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  /** Comandos vindos da IHM. Nunca confiar no cliente: tudo é validado aqui. */
  command(cmd: string, value: unknown) {
    if (cmd === "run") this.running = Boolean(value);
    if (cmd === "ritmo") {
      const v = Number(value);
      if (Number.isFinite(v)) this.ritmo = Math.min(100, Math.max(10, v));
    }

    // ---- ferramentas de desenvolvimento -----------------------------------
    if (cmd === "turbo") {
      const v = Number(value);
      if (Number.isFinite(v)) this.turbo = Math.min(20, Math.max(1, v));
    }
    if (cmd === "preview") {
      // O padrão completo, agora: é para conferir o DESENHO da pilha sem
      // esperar o braço. Pausa em seguida — conferiu, dá reset ou play.
      this.placed = [];
      for (let b = 0; b < TOTAL; b++) {
        const sl = slot(sideOf(b), b % PER_PALLET);
        this.placed.push({ ...sl.center, rot: sl.rot });
      }
      this.boxIdx = TOTAL - 1;
      this.wps = route(TOTAL - 1);
      this.wp = this.wps.length - 1;
      this.prog = Number.MAX_SAFE_INTEGER;
      this.dwell = 0;
      this.carrying = false;
      this.trocando = false;
      this.feedX = null;
      this.boxReady = false;
      this.cartDe = this.tcpRY();
      this.running = false;
    }
    if (cmd === "reset") {
      this.placed = [];
      this.boxIdx = 0;
      this.wps = route(0);
      this.wp = 0;
      this.prog = 0;
      this.jv = 0;
      this.dwell = 0;
      this.carrying = false;
      this.trocando = false;
      this.feedX = null;
      this.boxReady = false;
      this.pesoLido = 0;
      this.cartDe = this.tcpRY();
      this.running = true;
    }
  }

  // PTP sincronizado: cada delta pesado pela velocidade da própria junta;
  // a mais lenta para o seu trajeto governa o tempo de todas.
  private tick(dtReal: number) {
    // O turbo acelera o TEMPO, não o robô: as velocidades de junta continuam
    // as do datasheet — o relógio da simulação é que corre mais depressa.
    const dt = dtReal * this.turbo;
    this.giraInversores(dt);
    if (this.running) {
      // ------------------------- entrada: esteira -> balança ---------------
      // Uma caixa nova entra assim que a anterior sai da balança na garra.
      if (!this.trocando && !this.carrying && this.feedX === null) {
        this.feedX = FEED.start;
        this.pesoAlvo = 2.4 + Math.random() * 0.35;   // caixa a caixa varia
        this.pesagem = 0;
        this.boxReady = false;
      }
      if (this.feedX !== null && !this.boxReady) {
        if (this.feedX > PICK.r) {
          this.feedX = Math.max(PICK.r, this.feedX - FEED.vel * dt);
          // pesagem dinâmica: a leitura já acompanha ao entrar nos roletes
          if (this.feedX < PICK.r + 420) {
            this.pesoLido += (this.pesoAlvo - this.pesoLido) * Math.min(1, dt * 4);
          }
        } else {
          this.pesagem += dt;
          this.pesoLido += (this.pesoAlvo - this.pesoLido) * Math.min(1, dt * 8);
          if (this.pesagem >= FEED.settle) {
            this.boxReady = true;
            this.pesoLido = this.pesoAlvo;
          }
        }
      }

      if (this.trocando) {
        this.dwell += dt;
        if (this.dwell >= TROCA_S) {
          // paletes novos: a pilha some, a contagem zera
          this.placed = [];
          this.boxIdx = 0;
          this.wps = route(0);
          this.wp = 0;
          this.dwell = 0;
          this.cartDe = this.tcpRY();
          this.trocando = false;
        }
      } else {
        const alvo = this.wps[this.wp];
        let noAlvo = false;

        if (alvo.lin) {
          // ---- MOVL: linha reta cartesiana em (r, y), S fixo ----
          const de = this.cartDe;
          const dist = Math.hypot(alvo.lin.r - de.r, alvo.lin.y - de.y);
          if (this.prog < dist) {
            this.prog = Math.min(dist, this.prog + VEL_LIN * (this.ritmo / 100) * dt);
            const f = dist === 0 ? 1 : this.prog / dist;
            const [L, U] = ikLU(de.r + (alvo.lin.r - de.r) * f,
                                de.y + (alvo.lin.y - de.y) * f);
            this.j = [alvo.lin.s, L, U];
          } else {
            noAlvo = true;
          }
        } else {
          // ---- PTP sincronizado em junta ----
          const d = [0, 1, 2].map((i) => alvo.j[i] - this.jFrom[i]);
          const peso = [VMAX.L / VMAX.S, 1, VMAX.L / VMAX.U];
          const D = Math.max(...d.map((v, i) => Math.abs(v) * peso[i]));

          if (this.prog < D) {
            const vTop = VMAX.L * (this.ritmo / 100);
            const freio = Math.sqrt(2 * JACC * (D - this.prog));
            const vAlvo = Math.min(vTop, freio);
            this.jv = this.jv < vAlvo
              ? Math.min(vAlvo, this.jv + JACC * dt)
              : Math.max(vAlvo, this.jv - JACC * dt);
            this.prog = Math.min(D, this.prog + this.jv * dt);
            const f = D === 0 ? 1 : this.prog / D;
            for (let i = 0; i < 3; i++) this.j[i] = this.jFrom[i] + d[i] * f;
          } else {
            noAlvo = true;
          }
        }

        if (!noAlvo) {
          /* ainda a caminho */
        } else {
          this.jv = 0;
          this.dwell += dt;
          // Na aproximação da pega, quem LIBERA é a balança: o braço espera
          // em cima até a pesagem estabilizar — como o intertravamento real.
          if (this.wp === 0 && !this.boxReady) {
            this.dwell = Math.min(this.dwell, alvo.dwell);
          } else if (this.dwell >= alvo.dwell) {
            if (alvo.grip === "fecha") {
              this.carrying = true;
              this.feedX = null;          // a caixa saiu da balança
              this.boxReady = false;
            }
            if (alvo.grip === "abre") {
              this.carrying = false;
              const sl = slot(sideOf(this.boxIdx), this.boxIdx % PER_PALLET);
              // A orientação vem do PADRÃO (catavento), não do braço: o eixo
              // T (não modelado nas juntas) esquadra a caixa no ângulo do slot.
              this.placed.push({ ...sl.center, rot: sl.rot });
              this.okSim++;
            }
            this.dwell = 0;
            this.prog = 0;
            this.jFrom = [...this.j];
            this.cartDe = this.tcpRY();     // origem do próximo MOVL
            this.wp++;
            if (this.wp >= this.wps.length) {
              this.boxIdx++;
              if (this.boxIdx >= TOTAL) {
                this.trocando = true;
              } else {
                this.wps = route(this.boxIdx);
                this.wp = 0;
              }
            }
          }
        }
      }
    }

    const t = fkTcp(this.j);
    if (this.tcpPrev) {
      this.tcpSpeed = Math.hypot(
        t.x - this.tcpPrev.x, t.y - this.tcpPrev.y, t.z - this.tcpPrev.z) / dt;
    }
    this.tcpPrev = t;

    this.emit("state", this.snapshot());
  }

  snapshot(): RobotState {
    // Palete A enche inteiro primeiro: as 32 primeiras caixas são dele.
    const countA = Math.min(this.placed.length, PER_PALLET);
    const countB = this.placed.length - countA;
    const idx = Math.min(this.boxIdx, TOTAL - 1);
    return {
      j: [...this.j],
      phase: this.trocando ? -1 : this.wps[this.wp]?.phase ?? -1,
      phaseName: this.trocando ? "TROCA DE PALETES" : PHASES[this.wps[this.wp]?.phase ?? 0],
      carrying: this.carrying,
      feed: this.feedX === null ? null : {
        x: this.feedX,
        status: this.feedX > FEED.sealExit ? "SELANDO" as const
              : this.feedX > PICK.r ? "CHEGANDO" as const
              : this.boxReady ? "PRONTA" as const
              : "PESANDO" as const,
      },
      peso: Math.round(this.pesoLido * 100) / 100,
      running: this.running,
      ritmo: this.ritmo,
      turbo: this.turbo,
      // No simulador os dois paletes estao sempre presentes, menos na troca.
      status: {
        remoto: true, servoOn: true, emCiclo: this.running, emHome: false,
        falha: false, almRobo: 0, automatico: true,
        porta1: true, porta2: true, barreira1: true, barreira2: true,
        portas: true, barreiras: true, descargaCheia: this.trocando,
        vacuoLigado: this.carrying, vacuoOk: this.carrying, pressaoBar: 6.2,
        ladoAtivo: this.placed.length < PER_PALLET ? 1 : 2,
        almBalanca: 0, seladoraDesabilitada: false,
      },
      // O simulador nao tem broker nenhum. Zerado, e nao inventado como
      // "conectado": o card de conexao so' aparece com a fonte em REAL, e se
      // um dia aparecer aqui deve dizer a verdade -- nao ha' MQTT.
      mqtt: { conectado: false, ultimoQuadroMs: null, plcOk: false },
      emergencia: false,      // o simulador nao gera emergencia
      paletesProduzidos: 0,
      // O simulador não tem balança de verdade, então não inventa reprovação:
      // conta como OK o que ele mesmo depositou e deixa NÃO OK em zero. O
      // turno vem do relógio, igual ao do CLP, para a tela ficar coerente.
      producao: this.indicadores(),
      inversores: {
        entrada: this.inversorSim(this.rpmEntrada, this.rpmEntrada > 5 ? 1450 : 0, 0),
        balanca: this.inversorSim(this.rpmBalanca, this.rpmBalanca > 5 ? 900 : 0, 2.1),
      },
      paleteA: !this.trocando,
      paleteB: !this.trocando,
      // Na troca os dois paletes saem de cena na empilhadeira, para trás —
      // as caixas vão em cima, porque `placed` só é limpo ao fim da troca. O
      // progresso sai direto do relógio dela, e por isso a troca dura mais do
      // que a saída: se durasse menos, a pilha seria apagada no meio do
      // caminho e o palete terminaria a viagem vazio.
      saidaA: this.trocando ? Math.min(1, this.dwell / SAIDA_S) : 0,
      saidaB: this.trocando ? Math.min(1, this.dwell / SAIDA_S) : 0,
      fonte: "sim",
      realOk: false,        // o index.ts sobrescreve com o frescor da fonte real
      tcp: fkTcp(this.j),
      speed: this.running ? this.tcpSpeed : 0,
      placed: this.placed,
      boxIndex: idx,
      boxTotal: TOTAL,
      descartadas: 0,   // fluxo de descarte: a validar depois
      // O giro que a caixa da vez precisa ter ao assentar — o cliente usa
      // para animar o eixo T emulado durante o transporte.
      carryRot: slot(sideOf(idx), idx % PER_PALLET).rot,
      countA,
      countB,
    };
  }

  /** Indicadores para a tela em modo SIMULADOR.
   *
   *  Números do próprio simulador, não invenção: `ok` é quanto ele depositou
   *  desde que subiu. `nok` fica em zero porque aqui não há balança que
   *  reprove — mostrar reprovação fictícia ensinaria o operador a desconfiar
   *  do indicador quando ele for real. */
  private indicadores() {
    // A HORA É A DA FÁBRICA, não a do servidor.
    //
    // Em produção este processo roda num container em UTC: `getHours()` daria
    // 16h com a linha às 13h, e o turno sairia errado — às 15h no Brasil o
    // UTC marca 18h, e o simulador anunciaria turno 2 com a fábrica no
    // turno 1. Fixar o fuso aqui resolve sem depender de TZ no ambiente nem
    // de tzdata na imagem.
    //
    // Só o SIMULADOR precisa disto: na fonte real o turno vem do CLP, que
    // usa o relógio da CPU, já na hora local.
    // Formatador de módulo, nunca `new Intl.DateTimeFormat` aqui: ver
    // FORMATO_HORA_FABRICA. Esta linha roda 50 vezes por segundo.
    const hhmm = FORMATO_HORA_FABRICA.format(new Date());
    const [hora, minuto] = hhmm.split(":").map(Number);
    const min = hora * 60 + minuto;
    const turno = min >= 450 && min < 1050 ? 1 : (min >= 1050 || min < 170) ? 2 : 0;
    const ini = turno === 1 ? 450 : turno === 2 ? 1050 : min;
    let decorridos = min - ini;
    if (decorridos < 0) decorridos += 1440;
    return {
      turno,
      minutos: decorridos,
      ok: this.okSim,
      nok: 0,
      porHora: decorridos >= 5 ? Math.round((this.okSim * 60) / decorridos) : 0,
      semVeredito: 0,
      okAnterior: 0,
      nokAnterior: 0,
      okTotal: this.okSim,
      nokTotal: 0,
    };
  }

  stop() { clearInterval(this.timer); }
}
