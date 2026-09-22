// ============================================================================
//  Servidor do supervisório: HTTP (build do cliente) + WebSocket (estado).
//
//  DUAS FONTES, uma interface: o simulador e a célula real (via broker MQTT)
//  emitem o mesmo RobotState. O seletor REAL/SIMULADOR escolhe qual chega aos
//  navegadores; o simulador segue vivo em segundo plano como reserva.
//
//  LOGIN GOOGLE restrito ao domínio (AUTH_DOMINIO): ativa sozinho quando as
//  variáveis GOOGLE_CLIENT_ID/SECRET existem — sem elas, roda aberto (dev) e
//  avisa no console. O WebSocket também é gateado pela sessão.
// ============================================================================
import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import { createServer } from "node:http";
import v8 from "node:v8";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { Gp12Simulator, PHASES, PICK, PALLET, BOX, PED } from "./simulator.js";
import { MqttSource } from "./fonte-mqtt.js";
import type {
  ClientCmd, HelloMsg, PulsoMsg, RobotState, StateMsg,
} from "../shared/types.js";

const PORT = Number(process.env.PORT ?? 3001);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "client", "dist");

// ---------------------------------------------------------------- login ----
const G_ID = process.env.GOOGLE_CLIENT_ID;
const G_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DOMINIO = process.env.AUTH_DOMINIO ?? "grupomultilaser.com.br";
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const authAtivo = Boolean(G_ID && G_SECRET);

const app = express();

// Atrás do HTTPS do host (Render/Railway/nginx), o Express precisa confiar no
// X-Forwarded-Proto para o cookie de sessão valer como seguro.
app.set("trust proxy", 1);

const sessao = cookieSession({
  name: "supervisorio",
  secret: process.env.SESSION_SECRET ?? "dev-sem-segredo",
  maxAge: 12 * 60 * 60 * 1000,        // um turno de trabalho
  sameSite: "lax",
});
app.use(sessao);

// Saude do processo. ANTES da trava de login de proposito: um health check que
// precisa de sessao nao mede o servidor, mede o Google.
app.get("/healthz", (_req, res) => {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);

  // A REPARTICAO IMPORTA MAIS QUE O TOTAL.
  //
  // Quando a memoria sobe, o total nao diz onde ela esta - e "onde" e o que
  // escolhe o conserto:
  //
  //   heapUsed sobe   -> objetos JavaScript retidos, ou GC que nao roda
  //   external/arrayBuffers sobe -> Buffer: socket ou MQTT
  //   bufferKB sobe   -> cliente que nao drena, e a contrapressao nao segurou
  //
  // Sem esta linha a investigacao vira leitura de codigo e palpite, que foi
  // como se perderam duas tentativas em 21-22/09/2026.
  res.status(200).json({
    ok: true,
    clientes: wss.clients.size,
    rssMB: mb(m.rss),
    heapUsedMB: mb(m.heapUsed),
    heapTotalMB: mb(m.heapTotal),
    externalMB: mb(m.external),
    arrayBuffersMB: mb(m.arrayBuffers),
    bufferKB: Math.round(
      [...wss.clients].reduce((s, c) => s + c.bufferedAmount, 0) / 1024),
    limiteHeapMB: mb(v8.getHeapStatistics().heap_size_limit),
    uptimeS: Math.round(process.uptime()),
  });
});

if (authAtivo) {
  app.get("/auth/login", (_req, res) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", G_ID!);
    url.searchParams.set("redirect_uri", `${BASE_URL}/auth/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("hd", DOMINIO);          // dica de domínio na tela
    res.redirect(url.toString());
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      const code = String(req.query.code ?? "");
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: G_ID!,
          client_secret: G_SECRET!,
          redirect_uri: `${BASE_URL}/auth/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tok = (await r.json()) as { id_token?: string };
      if (!tok.id_token) throw new Error("sem id_token");

      // A Google valida a assinatura por nós neste endpoint.
      const vr = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${tok.id_token}`);
      const info = (await vr.json()) as {
        aud?: string; email?: string; email_verified?: string; hd?: string;
      };

      const doDominio = info.hd === DOMINIO
        || (info.email ?? "").endsWith(`@${DOMINIO}`);
      if (info.aud !== G_ID || info.email_verified !== "true" || !doDominio) {
        res.status(403).send(
          `Acesso restrito a contas @${DOMINIO}. <a href="/auth/login">Tentar de novo</a>`);
        return;
      }

      req.session!.email = info.email;
      res.redirect("/");
    } catch {
      res.status(500).send('Falha no login. <a href="/auth/login">Tentar de novo</a>');
    }
  });

  app.get("/auth/logout", (req, res) => {
    req.session = null;
    res.redirect("/auth/login");
  });

  // Tudo o mais exige sessão.
  app.use((req, res, next) => {
    if (req.session?.email) return next();
    res.redirect("/auth/login");
  });

  console.log(`[auth] login Google ATIVO — domínio @${DOMINIO}`);
} else if (process.env.NODE_ENV === "production") {
  // Em produção a trava é OBRIGATÓRIA: sem credenciais, ninguém entra —
  // melhor uma página de aviso do que o supervisório aberto na internet.
  app.use((_req, res) => {
    res.status(503).send(
      "<h1>Supervisório indisponível</h1>" +
      "<p>Login Google não configurado. Defina GOOGLE_CLIENT_ID, " +
      "GOOGLE_CLIENT_SECRET, BASE_URL e SESSION_SECRET no ambiente.</p>");
  });
  console.log("[auth] PRODUÇÃO SEM CREDENCIAIS — aplicação bloqueada até configurar");
} else {
  console.log("[auth] GOOGLE_CLIENT_ID ausente — servidor ABERTO (modo dev)");
}

// Em produção o Node serve o build do Vite. Em dev quem serve é o próprio
// Vite (porta 5173) com proxy do /ws para cá.
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const http = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// O upgrade do WebSocket passa pela MESMA sessão do cookie.
http.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ws")) { socket.destroy(); return; }
  const fakeRes = { writeHead() {}, end() {} } as never;
  sessao(req as never, fakeRes, () => {
    const temSessao = (req as { session?: { email?: string } }).session?.email;
    if (authAtivo && !temSessao) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
});

// ---------------------------------------------------------- as duas fontes --
const sim = new Gp12Simulator();
// Nenhuma falha da fonte real pode impedir o servidor de subir.
let real: MqttSource;
try {
  real = new MqttSource();
} catch (e) {
  console.error(`[fonte-real] nao inicializou (${(e as Error).message}) — só SIMULADOR`);
  real = new MqttSource("mqtt://desligado.invalido:1883");
}
// A FONTE É POR NAVEGADOR, não do servidor.
//
// Quem está de olho na célula em produção não pode ter a tela trocada porque
// outra pessoa, noutra sala, abriu o simulador para demonstrar. Cada conexão
// escolhe a sua e recebe só o que pediu.
//
// Os comandos de SIMULAÇÃO (pausar, ritmo, turbo, prévia, reiniciar) seguem
// globais de propósito: existe UM simulador no servidor, e todos que o
// estiverem assistindo veem o mesmo robô — como numa máquina de verdade.
//
// O PADRÃO É REAL. Isto é um supervisório: quem abre a tela quer ver a
// célula, não uma demonstração. Abrir no simulador tinha um risco pior do que
// a inconveniência — alguém olhando um robô que se move bonito e concluindo
// que a linha está produzindo. O simulador continua a um clique, e quando a
// fonte real não entrega, a tela diz SEM DADOS em vez de fingir movimento.
const fonteDe = new WeakMap<WebSocket, "sim" | "real">();
const fonteDo = (c: WebSocket) => fonteDe.get(c) ?? "real";

// ---------------------------------------------------------------- BANDA ----
//  Medido antes de mexer: 2,97 KB por quadro com os paletes cheios, a 25 Hz,
//  71,4 KB/s por navegador — 176 GB/mês com UMA aba aberta. Três quartos
//  disso eram `placed`, retransmitido 25 vezes por segundo embora mude umas
//  três vezes por minuto.
//
//  Duas economias, nesta ordem de tamanho:
//    1. `placed` e `status` só viajam quando mudam;
//    2. os números vão arredondados — meio grau de junta e um milímetro de
//       TCP não mudam um pixel na tela, e float cru custa 17 dígitos.
// ----------------------------------------------------------------------------

/** Quem ainda não recebeu um quadro COMPLETO nesta fonte. Sem ele, um cliente
 *  novo receberia um quadro magro e não teria pilha nenhuma para manter. */
const precisaCompleto = new WeakSet<WebSocket>();

const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);

/** O estado com os números na precisão que a tela realmente usa. */
function enxuto(state: RobotState, de: "sim" | "real") {
  return {
    ...state,
    fonte: de,
    realOk: real.ok,
    // As caixas em coordenada inteira: milímetro é a menor unidade da cena.
    placed: state.placed.map((b) => ({ x: r0(b.x), y: r0(b.y), z: r0(b.z), rot: b.rot })),
    j: [r1(state.j[0]), r1(state.j[1]), r1(state.j[2])] as [number, number, number],
    tcp: { x: r0(state.tcp.x), y: r0(state.tcp.y), z: r0(state.tcp.z) },
    speed: r0(state.speed),
    saidaA: r1(state.saidaA),
    saidaB: r1(state.saidaB),
  };
}

/** Serialização de cada campo no último quadro enviado, por fonte. */
const ultimo: Record<"sim" | "real", Map<string, string>> = {
  sim: new Map(),
  real: new Map(),
};

/** Quando chegou o último quadro de cada fonte. É o que o PULSO carrega:
 *  o servidor sabe se a fonte está falando; o navegador, não. */
const ultimoQuadro: Record<"sim" | "real", number> = { sim: 0, real: 0 };

function broadcast(state: RobotState, de: "sim" | "real") {
  ultimoQuadro[de] = Date.now();
  const completo = enxuto(state, de);
  const anterior = ultimo[de];

  // Diferença campo a campo. Regra única, sem lista de exceções: as juntas e
  // o TCP entram sempre porque sempre mudam; a pilha, o status e os
  // contadores entram quando têm o que dizer.
  const mudou: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(completo)) {
    const s = JSON.stringify(v);
    if (anterior.get(k) !== s) {
      mudou[k] = v;
      anterior.set(k, s);
    }
  }

  let parcial: string | null = null;
  let inteiro: string | null = null;

  for (const c of wss.clients) {
    if (c.readyState !== WebSocket.OPEN || fonteDo(c) !== de) continue;

    // CONTRAPRESSAO. Sem isto o servidor morre por memoria, e foi o que
    // derrubava a instancia a cada ~10 min (Render: "exceeded its memory
    // limit", 21/09/2026).
    //
    // Aba em segundo plano e CONGELADA pelo navegador: o socket segue aberto,
    // readyState continua OPEN, e o JavaScript para de drenar. Como o
    // alternador de abas da TV deixa esta tela oculta a maior parte do tempo,
    // esse era o estado normal, nao a excecao. Cada send() ia para o buffer de
    // saida, 25 vezes por segundo, sem teto.
    //
    // Quadro de supervisorio nao vale a pena empilhar: quando o cliente voltar
    // a ler, o que importa e o AGORA, nao os mil quadros que ele perdeu.
    if (c.bufferedAmount > BUFFER_MAX) continue;

    if (precisaCompleto.has(c)) {
      // Serializado no máximo uma vez por quadro, e só se houver quem precise.
      inteiro ??= JSON.stringify({ type: "state", ...completo } as StateMsg);
      c.send(inteiro);
      precisaCompleto.delete(c);
      continue;
    }

    // Nada mudou neste quadro: não se manda quadro nenhum. O enlace já tem
    // o seu próprio ping/pong para provar que está vivo — repetir
    // `{"type":"state"}` 25 vezes por segundo só para dizer "sem novidade"
    // seria pagar banda para não informar nada.
    if (Object.keys(mudou).length === 0) continue;

    parcial ??= JSON.stringify({ type: "state", ...mudou } as StateMsg);
    c.send(parcial);
  }
}

// ---------------------------------------------------------------- pulso --
//  Uma batida a cada 5 s para cada cliente, com ou sem novidade.
//
//  O protocolo delta não manda quadro repetido — é o que derrubou o tráfego
//  42 vezes —, mas isso deixa o navegador sem como distinguir "célula parada"
//  de "servidor sumiu". O pulso resolve dizendo as duas coisas de uma vez:
//  ele CHEGAR prova que o servidor está aí; o `fonteViva` dentro dele prova
//  que a fonte está falando.
//
//  Sem isso, a recarga automática da tela teria de disparar em cima do
//  silêncio — e silêncio, aqui, é o estado normal de uma célula parada.
/** Teto do buffer de saida por cliente. Acima disto o cliente nao esta
 *  lendo, e mandar mais e so consumir memoria do servidor. */
const BUFFER_MAX = 256 * 1024;

const PULSO_MS = 5000;
/** Além de quanto tempo sem quadro a fonte é dada por morta. Três vezes o
 *  período do pulso: um quadro perdido não condena ninguém. */
const FONTE_MORTA_MS = 15000;

setInterval(() => {
  const agora = Date.now();
  for (const c of wss.clients) {
    if (c.readyState !== WebSocket.OPEN) continue;
    const de = fonteDo(c);
    c.send(JSON.stringify({
      type: "pulso",
      fonteViva: agora - ultimoQuadro[de] < FONTE_MORTA_MS,
    } satisfies PulsoMsg));
  }
}, PULSO_MS);

// ------------------------------------------------------------ vida do enlace
//  O `pulso` acima prova ao NAVEGADOR que o servidor esta vivo. Nao prova o
//  contrario, e era isso que faltava: socket meio aberto - TV que dormiu, rede
//  que caiu, NAT que expirou - fica em readyState OPEN para sempre, porque
//  nada o desmente.
//
//  Ping/pong de WebSocket resolve, mas a biblioteca `ws` NAO o envia sozinha:
//  e preciso chamar ws.ping(). Quem nao responder em uma volta e derrubado.
const VIDA_MS = 30_000;
const vivos = new WeakSet<WebSocket>();

wss.on("connection", (ws) => {
  vivos.add(ws);
  ws.on("pong", () => vivos.add(ws));
});

setInterval(() => {
  for (const c of wss.clients) {
    if (!vivos.has(c)) { c.terminate(); continue; }   // nao respondeu a volta passada
    vivos.delete(c);
    c.ping();
  }
}, VIDA_MS);

// 50 Hz de simulação -> 25 Hz de rede; a fonte real já emite a 25 Hz.
let skip = false;
sim.on("state", (s: RobotState) => {
  skip = !skip;
  if (skip) return;
  broadcast(s, "sim");
});
real.on("state", (s: RobotState) => broadcast(s, "real"));

wss.on("connection", (ws) => {
  const hello: HelloMsg = {
    type: "hello",
    phases: [...PHASES],
    layout: {
      pick: { r: PICK.r, top: PICK.top },
      pallet: { size: PALLET.size, top: PALLET.top, r: PALLET.r },
      box: { w: BOX.w, d: BOX.d, h: BOX.h },
      pedestal: PED,
    },
  };
  ws.send(JSON.stringify(hello));
  // Primeiro estado deste cliente: completo, com pilha e status.
  precisaCompleto.add(ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as ClientCmd;
      if (!msg || typeof msg.cmd !== "string") return;
      if (msg.cmd === "fonte") {
        // Só esta conexão troca de fonte. As outras seguem onde estavam.
        if (msg.value === "sim" || msg.value === "real") {
          fonteDe.set(ws, msg.value);
          // Fonte nova, pilha nova: o próximo quadro tem de vir completo.
          precisaCompleto.add(ws);
        }
        return;
      }
      // Comandos de simulação valem SÓ para o simulador — a célula real não
      // se comanda por aqui (segurança: supervisório real observa, não move).
      sim.command(msg.cmd, "value" in msg ? msg.value : undefined);
    } catch { /* mensagem malformada: ignora */ }
  });
});

http.listen(PORT, () => {
  console.log(`[supervisorio] WS/HTTP em http://localhost:${PORT}`);
  if (!fs.existsSync(dist)) {
    console.log("[supervisorio] dev: abra o Vite em http://localhost:5173");
  }
});
