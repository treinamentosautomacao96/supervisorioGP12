// ============================================================================
//  Contrato entre servidor e navegador — o ÚNICO lugar que define as mensagens.
// ============================================================================

export interface Vec3 { x: number; y: number; z: number }

/** Um acionamento visto pelo supervisório — SÓ LEITURA.
 *
 *  Não há comando aqui de propósito: reconhecer falha e mudar setpoint são
 *  ações com consequência física, e esta tela é vista de longe, às vezes por
 *  quem passa. Quem religa a esteira faz isso na IHM da máquina, onde está
 *  quem enxerga a esteira. */
export interface Inversor {
  /** O drive confirma que está habilitado. */
  ligado: boolean;
  /** Lockout do SINA_SPEED. */
  bloqueado: boolean;
  erro: boolean;
  /** A segurança permite girar. Sem isto, "parado" não se distingue de
   *  "impedido" — que é a pergunta nº 1 de quem acha uma esteira parada. */
  stoLiberado: boolean;
  /** F-I/O passivado: precisa do RESET SEGURANÇA, e não se resolve esperando. */
  aguardaReset: boolean;
  rpm: number;
  /** O setpoint. A DIFERENÇA para o real é que diagnostica: comandado em
   *  1700 com real em 900 é limite de corrente, correia patinando ou carga
   *  travando. Só o real não conta essa história. */
  rpmComandado: number;
  /** A (ampère). O número mais valioso do conjunto: subindo devagar ao longo
   *  de semanas é rolamento travando ou correia tensionada. */
  corrente: number;
  torque: number;   // Nm
  potencia: number; // W
  /** Diagnóstico do SINA_SPEED em bruto — traduzido aqui, não no CLP. */
  status: number;
  diagId: number;
}

/** Os dois acionamentos da célula. Cada lado é `null` enquanto a chamada
 *  correspondente da FC 09 não estiver no Main do CLP. */
export interface Inversores {
  entrada: Inversor | null;
  balanca: Inversor | null;
}

/** Caixa depositada: posição do centro + orientação (giro em torno do vertical). */
export interface PlacedBox extends Vec3 { rot: number }

/** Estado do robô num instante. As juntas em graus: [S, L, U]. */
export interface RobotState {
  j: [number, number, number];
  /** Índice em phases; -1 = troca de paletes. */
  phase: number;
  phaseName: string;
  carrying: boolean;
  /** A caixa na entrada: posição no eixo da linha e o estágio dela.
   *  null = nenhuma caixa na entrada (está na garra, ou troca de paletes). */
  feed: {
    x: number;
    status: "SELANDO" | "CHEGANDO" | "PESANDO" | "PRONTA" | "REPROVADA";
  } | null;
  /** Leitura atual da balança Toledo (kg). Mantém a última pesagem. */
  peso: number;
  running: boolean;
  ritmo: number;
  /** Multiplicador de tempo da simulação (dev). 1 = tempo real. */
  turbo: number;
  /** Presença de palete nos dois lados (SP4/SP5). Sem palete, a cena não
   *  desenha nem o palete nem a pilha — nada de pilha fantasma. */
  paleteA: boolean;
  paleteB: boolean;
  /** SAÍDA do palete: 0 = no lugar · 1 = já saiu de cena. Entre os dois, a
   *  empilhadeira está levando o palete pelo lado livre (o que não tem
   *  batente). Quem cronometra é o SERVIDOR, não o navegador: enquanto o
   *  progresso não chega a 1 a pilha daquele lado continua em `placed`, senão
   *  sairia um palete vazio e as caixas evaporariam no lugar. */
  saidaA: number;
  saidaB: number;
  /** Célula em emergência: o braço congela onde estava. */
  emergencia: boolean;
  /** Paletes completos produzidos (contador do CLP). */
  paletesProduzidos: number;

  /** Indicadores de produção do turno. `null` quando não há de onde tirar —
   *  o bloco do CLP ainda não está carregado, ou a fonte é o simulador antes
   *  do primeiro depósito. Melhor ausente e explícito do que zerado e
   *  ambíguo: card com zeros o operador lê como produção parada. */
  producao: {
    turno: number;
    minutos: number;
    ok: number;
    nok: number;
    porHora: number;
    semVeredito: number;
    okAnterior: number;
    nokAnterior: number;
    okTotal: number;
    nokTotal: number;
  } | null;

  /** Os dois inversores das esteiras (HR50..69, do FC 09). */
  inversores: Inversores;

  /** Status para a tela. Cada campo aqui existe para responder a UMA
   *  pergunta do operador ou da manutenção — nada de despejar sinal cru. */
  status: {
    // ---- o robô está em condição de produzir? ----
    remoto: boolean;        // REMOTO = o CLP comanda; LOCAL = alguém no pendant
    servoOn: boolean;
    emCiclo: boolean;       // master job rodando
    emHome: boolean;
    falha: boolean;
    almRobo: number;        // código do alarme: é o que a manutenção precisa

    // ---- se está parado, o que impede? ----
    automatico: boolean;    // modo da CÉLULA (diferente do remoto do robô)
    portas: boolean;        // as duas chaves de segurança fechadas
    barreiras: boolean;     // as duas barreiras livres
    descargaCheia: boolean; // palete cheio esperando empilhadeira

    // ---- a ferramenta e o ar: a causa nº 1 de parada em célula de ventosa ----
    vacuoLigado: boolean;
    vacuoOk: boolean;       // ligado SEM ok = caixa caiu ou vazamento
    pressaoBar: number;

    // ---- a linha em volta ----
    ladoAtivo: 1 | 2 | 0;
    almBalanca: number;
    seladoraDesabilitada: boolean;
  };
  /** De onde os dados vêm agora. */
  fonte: "sim" | "real";
  /** Em modo real: o broker está entregando dados frescos? */
  realOk: boolean;
  tcp: Vec3;
  speed: number;
  /** Caixas já paletizadas (mundo, mm) — o cliente as desenha. */
  placed: PlacedBox[];
  boxIndex: number;
  boxTotal: number;
  /** Caixas reprovadas pela balança e descartadas pelo robô. */
  descartadas: number;
  /** Orientação (yaw, graus) em que a caixa da vez assenta no palete. */
  carryRot: number;
  countA: number;
  countB: number;
}

/** Primeira mensagem após conectar: o que o cliente precisa para se montar. */
export interface HelloMsg {
  type: "hello";
  phases: string[];
  layout: {
    pick: { r: number; top: number };
    pallet: { size: number; top: number; r: number };
    /** Caixa de ventilador de mesa, EM PÉ: w de largura, d de lombada, h de altura. */
    box: { w: number; d: number; h: number };
    /** Altura do pedestal do robô (mm) — necessário para alcançar a 2ª camada. */
    pedestal: number;
  };
}

/** Estado no fio — SÓ O QUE MUDOU.
 *
 *  MEDIDO antes de existir esta regra: com os dois paletes cheios, o estado
 *  completo dá 2,97 KB e, a 25 Hz, 71,4 KB/s POR NAVEGADOR — 176 GB por mês
 *  com uma única aba aberta. E 76,5 % disso era `placed`, a lista das 64
 *  caixas já depositadas, retransmitida 1.500 vezes por minuto porque um
 *  ângulo de junta mudou.
 *
 *  Agora cada campo viaja apenas quando o seu valor muda. Campo AUSENTE
 *  significa "igual ao que você já tem": o cliente mantém o último recebido.
 *  Os que mudam a cada quadro — juntas, TCP, velocidade — aparecem sempre,
 *  porque sempre mudam; os outros aparecem quando têm o que dizer.
 *
 *  Quem acaba de conectar, ou de trocar de fonte, recebe um quadro COMPLETO
 *  antes de qualquer quadro parcial; sem isso não haveria o que manter. */
export type StateMsg = { type: "state" } & Partial<RobotState>;

/** PULSO — o servidor dizendo que está vivo, e se a FONTE também está.
 *
 *  Existe por causa do próprio protocolo delta: quadro sem novidade não é
 *  enviado, então silêncio na rede não distingue "célula parada" de "dado
 *  travado". Sem este pulso, a tela teria de tratar as duas do mesmo jeito —
 *  e recarregar sozinha toda vez que o robô ficasse um minuto sem se mexer.
 *
 *  `fonteViva` é o que o SERVIDOR sabe e o navegador não: houve quadro da
 *  fonte ativa há pouco. Com ele, a tela separa "o servidor sumiu" de "o
 *  servidor está aí e o dado é que parou" — duas falhas com donos
 *  diferentes.
 *
 *  Custo: ~30 bytes a cada 5 s por cliente, uns 15 MB por mês. Contra os
 *  4,2 GB do enlace, é ruído. */
export type PulsoMsg = { type: "pulso"; fonteViva: boolean };

export type ServerMsg = HelloMsg | StateMsg | PulsoMsg;

/** Comandos da IHM para o servidor. O servidor valida tudo. */
export type ClientCmd =
  | { cmd: "run"; value: boolean }
  | { cmd: "ritmo"; value: number }
  /** Ferramentas de DESENVOLVIMENTO — não existem na célula real. */
  | { cmd: "preview" }             // monta os dois paletes instantaneamente
  | { cmd: "reset" }               // zera tudo e recomeça da caixa 1
  | { cmd: "turbo"; value: number } // acelera o TEMPO da simulação (1..20x)
  /** Troca da fonte de dados: célula real (MQTT) ou simulador. */
  | { cmd: "fonte"; value: "sim" | "real" };

/** O que o GATEWAY publica no broker — uma mensagem JSON por mudança.
 *
 *  Espelha o mapa Modbus REAL da célula (DB 37 "MODBUS HOLDINGS" do projeto
 *  CLP_VENTILADOR_EMBALAGEM). Ver docs/ARQUITETURA.md §1 e plc/07_SUPERVISORIO.scl.
 *  Os nomes são os do CLP, não os do simulador — quem for conferir com o
 *  eletricista lê a mesma coisa nos dois lados. */
export interface RealPayload {
  ts: number;              // epoch ms de quando o gateway leu
  plcOk: boolean;          // heartbeat do CLP (HR26) está andando?

  /** HR10 — estado do robô */
  robo: {
    run: boolean; servoOn: boolean; masterJob: boolean; falha: boolean;
    remoto: boolean; home: boolean; foraHome: boolean; pegaOk: boolean;
    lado1: boolean; lado2: boolean; caixaIndexador: boolean;
    vacuoLigado: boolean; vacuoOk: boolean; descargaCheia: boolean;
    fimEncaix1: boolean; fimEncaix2: boolean;
  };

  /** HR11 — célula e segurança */
  celula: {
    caixaNaEsteira: boolean; indexadorAvancado: boolean; pecaNoRobo: boolean;
    /** Presença de palete: SP4 e SP5 (os SP1/SP2 não são presença real). */
    palete1: boolean; palete2: boolean;
    esteiraEntrada: boolean; esteiraSaida: boolean; seladoraDesabilitada: boolean;
    automatico: boolean; porta1: boolean; porta2: boolean;
    barreira1: boolean; barreira2: boolean; torreVermelha: boolean;
    /** Emergência consolidada do DB COMANDOS, e a causa por botão. */
    emergencia: boolean; emergenciaBotao: boolean;
  };

  /** HR12..14 — passos das sequências (DB "ESTADOS") */
  passos: { inicializacao: number; lado1: number; lado2: number };

  /** HR15..22 — números do processo, vindos do robô */
  qtdeLado1: number;
  place: number;           // posição dentro da sequência do mosaico
  camadaRetorno: number;
  alturaCaixa: number;
  alturaPallet: number;
  shiftY: number;
  shiftZ: number;
  camadaComando: number;

  /** HR27 — paletes completos produzidos (contador do DB COMANDOS). */
  paletesProduzidos: number;

  /** HR28 — CAUSAS da emergência: a HR11 diz QUE há, esta diz POR QUÊ. */
  causaEmergencia: {
    botoes: boolean; chaveSeg1: boolean; chaveSeg2: boolean;
    barreira1: boolean; barreira2: boolean;
    botaoLado1: boolean; botaoLado2: boolean;
    chaveLado1: boolean; chaveLado2: boolean;
    resetSeguranca: boolean;
    botaoPainel: boolean; botaoPorta1: boolean; botaoPorta2: boolean;
    botaoRobo: boolean;
  };

  /** HR29 — qual dos SETE mosaicos está ativo, e a variante de produto.
   *  Sem isto, trocar de produto faria a tela desenhar a pilha no padrão
   *  errado: contagem certa, posições erradas. */
  mosaico: {
    paletizar: number;      // 1..7, ou 0 se nenhum bit ativo
    encaixotar: number;     // 3..7, ou 0
    caixaPequena: boolean;
    armarCx4: boolean;
    encaixotando: boolean;
  };

  /** HR30 — torre de sinalização, os TRÊS vácuos e condições. */
  torre: {
    vermelho: boolean; amarelo: boolean; verde: boolean; buzzer: boolean;
    /** VC1/VC2/VC3: o padrão de quais caíram diz se foi caixa torta,
     *  ventosa entupida ou falta de ar. */
    vc1: boolean; vc2: boolean; vc3: boolean;
    condicaoCiclo: boolean;
    condicaoLado1: boolean; condicaoLado2: boolean;
    inatividade: boolean;
    trocarGarra: boolean; posicaoTrocaGarra: boolean;
    rejeitarMaster: boolean; devolverMaster: boolean;
    ligaDesliga: boolean;
  };

  /** HR31..34 — status numéricos do DB COMANDOS, em bruto. */
  statusRobo: number;
  statusLado1: number;
  statusLado2: number;
  autoManual: number;

  /** HR23..25 */
  almRobo: number;
  almBalanca: number;
  pressaoBar: number;

  /** HR35..HR46 — produção por turno, do FB "08 - INDICADORES".
   *
   *  Zerado enquanto esse bloco não estiver carregado no CLP: as holdings
   *  existem no DB e ninguém escreve nelas. Quem consome distingue "zero
   *  porque não produziu" de "zero porque o bloco não existe" pelos TOTAIS,
   *  que nunca zeram depois do primeiro turno. */
  producao: {
    turno: number;          // 0 fora de turno · 1 · 2
    minutos: number;        // decorridos do turno
    ok: number;
    nok: number;
    porHora: number;        // só OK
    /** Das NÃO OK, quantas por AUSÊNCIA de veredito da balança. É
     *  SUBCONJUNTO de `nok`, não uma terceira categoria — somar as duas
     *  conta a mesma peça duas vezes. Serve para separar problema de
     *  produto de problema de integração. */
    semVeredito: number;
    okAnterior: number;
    nokAnterior: number;
    okTotal: number;        // acumulado, DInt de 32 bits
    nokTotal: number;
  };

  /** HR50..HR69 — os dois acionamentos, do FC "09 - SUPERVISORIO INVERSORES".
   *
   *  Opcional na raiz porque um gateway ANTIGO, ainda lendo 47 words, não
   *  manda esta chave. Sem o `?`, atualizar o servidor antes do PC de fábrica
   *  quebraria a tela inteira por causa de um campo que ela nem mostra. */
  inversores?: {
    entrada: Inversor | null;
    balanca: Inversor | null;
  };

  /** HR0..3 — a integração de balança que já existia */
  balanca: {
    pecaEmPosicao: boolean;
    peso: 0 | 1 | 2;       // 0 aguardando · 1 OK · 2 NOK
    lifeBit: boolean;
  };
}
