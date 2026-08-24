// ============================================================================
//  TESTE DO SERVIDOR MODBUS DO CLP — lê HR0..HR26 duas vezes e traduz.
//
//    npm run testa-modbus            (usa PLC_IP do gateway/.env)
//    npm run testa-modbus -- 192.168.0.15   (ou passa o IP direto)
//
//  O que ele prova, em ordem:
//   1. a porta 502 aceita conexão      -> MB_SERVER tem instância livre
//   2. a leitura FC03 responde          -> mapa de holdings acessível
//   3. o HR26 MUDA entre duas leituras  -> o PROGRAMA está rodando (heartbeat)
//  Se o 3 falhar com 1 e 2 passando: CLP em STOP, ou a FC 07 não foi chamada.
// ============================================================================
import "dotenv/config";
import ModbusRTU from "modbus-serial";

const ip = process.argv[2] ?? process.env.PLC_IP ?? "192.168.0.10";
const port = Number(process.env.PLC_PORT ?? 503);   // 502 e da balanca
const int16 = (v: number) => (v > 0x7fff ? v - 0x10000 : v);
const bits = (w: number) =>
  [...Array(16)].map((_, i) => ((w >> i) & 1)).join("").replace(/(....)/g, "$1 ");

const NOMES = [
  "0  balanca: peca em posicao",
  "1  balanca: peso (0 aguarda/1 OK/2 NOK)",
  "2  balanca: life bit",
  "3  clp->balanca: life bit",
  "4..9  (livres)",
  "", "", "", "", "",
  "10 ROBO   (bits: run servoOn masterJob falha remoto home foraHome pegaOk L1 L2 index vacLig vacOk descCheia fim1 fim2)",
  "11 CELULA (bits: cxEsteira index pecaRobo pal1 pal2 pal1b pal2b estEnt estSai selDesab auto porta1 porta2 barr1 barr2 torreVerm)",
  "12 passo INICIALIZACAO ROBO",
  "13 passo PALETIZACAO LADO 1",
  "14 passo PALETIZACAO LADO 2",
  "15 QTDE do lado ativo",
  "16 PLACE",
  "17 camada (retorno)",
  "18 altura caixa",
  "19 altura pallet",
  "20 shift Y",
  "21 shift Z",
  "22 camada (comando)",
  "23 alarme robo",
  "24 alarme balanca",
  "25 pressao (centesimos de bar)",
  "26 HEARTBEAT",
];

async function main() {
  const m = new ModbusRTU();
  console.log(`\n[1/3] conectando em ${ip}:${port} ...`);
  try {
    await m.connectTCP(ip, { port });
    m.setID(Number(process.env.PLC_UNIT ?? 1));
    m.setTimeout(1500);
    console.log("      OK — porta aberta, MB_SERVER aceitou a conexão");
  } catch (e) {
    console.error(`      FALHOU: ${(e as Error).message}`);
    console.error("      -> CLP em RUN? IP certo? Outra instância MB_SERVER livre?");
    process.exit(1);
  }

  console.log("[2/4] lendo HR0..HR46 (FC03) ...");
  const l1 = (await m.readHoldingRegisters(0, 47)).data;
  console.log("      OK — resposta em uma transação:\n");
  l1.forEach((v, i) => {
    const nome = NOMES[i] ?? "";
    if (nome === "") return;
    const extra = (i === 10 || i === 11) ? `  [${bits(v)}]` : "";
    console.log(`      HR${String(i).padStart(2)} = ${String(int16(v)).padStart(6)}${extra}  ${nome.slice(2)}`);
  });

  console.log("\n[3/3] heartbeat: lendo de novo em 500 ms ...");
  await new Promise((r) => setTimeout(r, 500));
  const l2 = (await m.readHoldingRegisters(0, 47)).data;
  if (l2[26] !== l1[26]) {
    console.log(`      OK — HR26 mudou (${l1[26]} -> ${l2[26]}): o programa RODA e a FC 07 está sendo chamada.\n`);
  } else {
    console.log(`      FALHOU — HR26 parado em ${l1[26]}.`);
    console.log("      -> CLP em STOP? Ou a FC '07 - SUPERVISORIO' ainda não é chamada no Main?\n");
    process.exit(2);
  }
  // ---------------------------------------------------------------------
  //  4/4 — o FB "08 - INDICADORES" está carregado?
  //
  //  Não dá para provar isso por um bit: as holdings HR35..46 existem no DB
  //  de qualquer forma, e valem zero se ninguém escrever nelas. O que se
  //  pode afirmar com honestidade é o negativo — tudo zerado E fora de
  //  turno significa que o bloco não está publicando. Com turno aberto ou
  //  algum total acumulado, ele está.
  // ---------------------------------------------------------------------
  console.log("[4/4] indicadores de produção (HR35..HR46) ...");
  const turno = int16(l2[35]);
  const okTot = l2[43] * 65536 + l2[44];
  const nokTot = l2[45] * 65536 + l2[46];
  const vivo = turno !== 0 || okTot > 0 || nokTot > 0;

  if (vivo) {
    console.log(`      OK — o FB 08 está publicando.
`);
    console.log(`      turno ativo ....... ${turno === 0 ? "fora de turno" : turno}`);
    console.log(`      minutos do turno .. ${int16(l2[36])}`);
    console.log(`      peças OK .......... ${int16(l2[37])}`);
    console.log(`      peças NÃO OK ...... ${int16(l2[38])}`);
    console.log(`      peças / hora ...... ${int16(l2[39])}`);
    console.log(`      sem pesagem ....... ${int16(l2[40])}   (subconjunto das NÃO OK)`);
    console.log(`      turno anterior .... ${int16(l2[41])} OK · ${int16(l2[42])} NÃO OK`);
    console.log(`      acumulado ......... ${okTot} OK · ${nokTot} NÃO OK
`);
  } else {
    console.log("      HR35..HR46 todas em zero.");
    console.log("      -> Se o FB '08 - INDICADORES' ainda não foi carregado, é o esperado.");
    console.log("      -> Se já foi: ele é chamado no Main? A instância tem Retain marcado?");
    console.log("      (não é falha do gateway — ele publica zero e o supervisório");
    console.log("       mostra AGUARDANDO O CLP em vez de fingir produção parada)");
    console.log("");
  }

  m.close(() => process.exit(0));
}

main();
