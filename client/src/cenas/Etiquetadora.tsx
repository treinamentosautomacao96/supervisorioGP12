// ============================================================================
//  CÉLULA DE ETIQUETAGEM — robô Epson
//
//  Cena NOVA, em construção. Vive separada da célula de paletização de
//  propósito: o supervisório do GP12 está em produção e não pode balançar
//  enquanto esta aqui muda de forma toda hora.
//
//  Acessa-se por  ?cena=etiquetadora  na URL.
//
//  Tudo em MILÍMETROS e no mesmo referencial do outro cenário: Y para cima,
//  chão em zero. Assim as duas cenas podem, um dia, dividir componentes.
//
//  O QUE JÁ ESTÁ AQUI
//    esteira de 6000 x 700, topo da correia a 900 mm do chão
//    caixa do produto 460 x 170 x 220 (orientação a confirmar)
//    portal de perfil 30 x 30 a 800 mm da entrada (altura a confirmar)
//
//  SENTIDO DO FLUXO: entra em -X, sai em +X.
//
//  O QUE FALTA (esperando informação)
//    modelo do robô Epson (SCARA ou 6 eixos muda a geometria inteira)
//    onde ele fica em relação à esteira, e de que lado
//    impressora/aplicador de etiqueta
//    o produto: dimensões e como chega
//    sensores e o que vira sinal
// ============================================================================
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { memo, useRef } from "react";
import * as THREE from "three";

// ---------------------------------------------------------------- medidas --
// TODAS CONFIRMADAS pelo autor da célula: 6 m x 0,70 m, altura de 90 cm.
// A altura é a cota que governa o resto — alcance do robô, se ele vai em
// pedestal, onde entra o aplicador. Por isso vem antes de tudo.
export const ESTEIRA = {
  comp: 6000,
  larg: 700,
  altura: 900,
  correia: 14,        // espessura da correia
  perfil: 90,         // altura do perfil lateral
  guia: 60,           // altura das guias laterais do produto
} as const;

// SENTIDO DO FLUXO: a caixa ENTRA em -X e corre para +X. Tudo o que for
// "distância da entrada" conta a partir de x = -comp/2.
export const ENTRADA_X = -ESTEIRA.comp / 2;

// Caixa do produto: 46 x 17 x 22 cm.
//
// ORIENTAÇÃO A CONFIRMAR. Aqui ela viaja com os 460 no SENTIDO DO FLUXO, que
// deixa 265 mm de folga de cada lado na esteira de 700. Atravessada, os 460
// ocupariam a largura e sobrariam só 120 mm por lado — e isso muda qual face
// passa sob o portal, ou seja, onde a etiqueta é aplicada.
export const CAIXA = {
  comp: 460,          // no sentido do fluxo (X)
  larg: 170,          // atravessando a esteira (Z)
  alt: 220,
} as const;

// Portal de perfil de alumínio 30 x 30, a 800 mm da entrada.
// A ALTURA ainda não foi informada — 1500 mm deixa 380 mm de vão livre sobre
// o topo da caixa (que fica a 1120 do chão). Marcado como palpite.
export const PORTAL = {
  perfil: 30,
  distEntrada: 800,
  altura: 1500,       // <- CONFIRMAR
  vaoExtra: 90,       // quanto as colunas ficam para fora da esteira
} as const;

const ALUMINIO = "#9AA6B2";
const CINZA_ESTR = "#5A6B7C";
const CINZA_ESC = "#39434E";
const CORREIA = "#2F8B5B";
const INOX = "#7E8B98";

/** Estrutura + correia + guias + pés. Origem no CENTRO da esteira, no chão;
 *  o comprimento corre em X. */
function Esteira() {
  const { comp, larg, altura, correia, perfil, guia } = ESTEIRA;
  // Pés a cada ~1,5 m, e nunca nas pontas — como se monta de verdade.
  const vaos = 4;
  const passo = comp / vaos;
  const pes: number[] = [];
  for (let i = 0; i <= vaos; i++) pes.push(-comp / 2 + i * passo);

  return (
    <group>
      {/* perfil estrutural */}
      <mesh position={[0, altura - perfil / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[comp, perfil, larg]} />
        <meshStandardMaterial color={CINZA_ESTR} roughness={0.5} metalness={0.35} />
      </mesh>

      {/* correia */}
      <mesh position={[0, altura + correia / 2, 0]} receiveShadow>
        <boxGeometry args={[comp - 40, correia, larg - 30]} />
        <meshStandardMaterial color={CORREIA} roughness={0.8} />
      </mesh>

      {/* guias laterais: é o que mantém o produto no eixo */}
      {[-1, 1].map((lado) => (
        <mesh
          key={lado}
          position={[0, altura + correia + guia / 2, lado * (larg / 2 - 8)]}
          castShadow
        >
          <boxGeometry args={[comp, guia, 16]} />
          <meshStandardMaterial color={INOX} roughness={0.35} metalness={0.6} />
        </mesh>
      ))}

      {/* tambores das pontas */}
      {[-1, 1].map((lado) => (
        <mesh
          key={lado}
          position={[lado * (comp / 2 - 20), altura + correia / 2, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[42, 42, larg - 30, 24]} />
          <meshStandardMaterial color={INOX} roughness={0.35} metalness={0.6} />
        </mesh>
      ))}

      {/* pés, em pares */}
      {pes.map((x, i) =>
        [-1, 1].map((lado) => (
          <mesh
            key={`${i}-${lado}`}
            position={[x, (altura - perfil) / 2, lado * (larg / 2 - 60)]}
            castShadow
          >
            <boxGeometry args={[60, altura - perfil, 60]} />
            <meshStandardMaterial color={CINZA_ESC} roughness={0.6} />
          </mesh>
        )),
      )}

      {/* travessas entre os pés: sem elas a estrutura parece flutuar */}
      {pes.map((x, i) => (
        <mesh key={`t${i}`} position={[x, 180, 0]} castShadow>
          <boxGeometry args={[50, 50, larg - 140]} />
          <meshStandardMaterial color={CINZA_ESC} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/** Portal de perfil de alumínio 30 x 30 sobre a esteira.
 *
 *  Perfil estruturado de verdade tem ranhura nas quatro faces; aqui o vinco
 *  é sugerido por uma faixa mais escura no meio de cada face. A esta
 *  distância isso lê como alumínio estruturado sem custar geometria. */
function Portal() {
  const { perfil, distEntrada, altura, vaoExtra } = PORTAL;
  const x = ENTRADA_X + distEntrada;
  const meiaLarg = ESTEIRA.larg / 2 + vaoExtra;

  return (
    <group position={[x, 0, 0]}>
      {/* colunas */}
      {[-1, 1].map((lado) => (
        <group key={lado} position={[0, 0, lado * meiaLarg]}>
          <mesh position={[0, altura / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[perfil, altura, perfil]} />
            <meshStandardMaterial color={ALUMINIO} roughness={0.42} metalness={0.55} />
          </mesh>
          {/* ranhura sugerida, nas duas faces que se veem */}
          {[[perfil / 2 + 0.6, 0], [0, perfil / 2 + 0.6]].map(([dx, dz], i) => (
            <mesh key={i} position={[dx, altura / 2, dz]} rotation-y={i ? 0 : Math.PI / 2}>
              <planeGeometry args={[perfil * 0.34, altura - 8]} />
              <meshStandardMaterial color="#6E7A87" roughness={0.6} metalness={0.4} />
            </mesh>
          ))}
          {/* base aparafusada no chão */}
          <mesh position={[0, 6, 0]} castShadow>
            <boxGeometry args={[perfil * 3, 12, perfil * 3]} />
            <meshStandardMaterial color="#4A545F" roughness={0.6} metalness={0.4} />
          </mesh>
        </group>
      ))}

      {/* travessa superior, de fora a fora das colunas */}
      <mesh position={[0, altura - perfil / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[perfil, perfil, meiaLarg * 2 + perfil]} />
        <meshStandardMaterial color={ALUMINIO} roughness={0.42} metalness={0.55} />
      </mesh>

      {/* cantoneiras: o que dá rigidez ao portal e o que se vê de longe */}
      {[-1, 1].map((lado) => (
        <mesh
          key={lado}
          position={[0, altura - 130, lado * (meiaLarg - 130)]}
          rotation-x={lado * Math.PI / 4}
          castShadow
        >
          <boxGeometry args={[perfil * 0.8, 250, perfil * 0.8]} />
          <meshStandardMaterial color={ALUMINIO} roughness={0.5} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Caixas na esteira, para dar escala. Posições fixas por enquanto — sem
 *  processo definido, animá-las seria inventar um ritmo que ninguém mediu. */
function Caixas() {
  const y = ESTEIRA.altura + ESTEIRA.correia + CAIXA.alt / 2;
  // uma antes do portal, uma sob ele, e duas adiante
  const xs = [ENTRADA_X + 300, ENTRADA_X + PORTAL.distEntrada,
              ENTRADA_X + 1800, ENTRADA_X + 2900];
  return (
    <group>
      {xs.map((x, i) => (
        <group key={i} position={[x, y, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[CAIXA.comp, CAIXA.alt, CAIXA.larg]} />
            <meshStandardMaterial color="#A97C4B" roughness={0.85} />
          </mesh>
          {/* fita de fechamento no topo, só para a caixa não ser um bloco liso */}
          <mesh position={[0, CAIXA.alt / 2 + 0.6, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[CAIXA.comp, 48]} />
            <meshStandardMaterial color="#8A6238" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Régua de cotas no chão, para conferir escala de olho enquanto se modela.
 *  Sai quando a cena estiver fechada. */
function Cotas() {
  const { comp, larg } = ESTEIRA;
  return (
    <group position={[0, 2, 0]}>
      {[[comp, 26, larg / 2 + 260], [40, larg, 0]].map(([w, d, z], i) => (
        <mesh key={i} position={[0, 0, z as number]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w as number, d as number]} />
          <meshBasicMaterial color="#4FC4D6" transparent opacity={0.28} />
        </mesh>
      ))}
    </group>
  );
}

/** Gira devagar em torno da cena — só para conferir o volume de todos os
 *  lados enquanto não há processo para animar. */
function CameraQueGira({ ativo }: { ativo: boolean }) {
  const t = useRef(0);
  useFrame((s, dt) => {
    if (!ativo) return;
    t.current += dt * 0.12;
    const r = 7200;
    s.camera.position.set(Math.cos(t.current) * r, 3000, Math.sin(t.current) * r);
    s.camera.lookAt(0, 900, 0);
  });
  return null;
}

function CenaEtiquetadora({ girar = false }: { girar?: boolean }) {
  return (
    <Canvas
      shadows
      camera={{ position: [5200, 3000, 4600], fov: 40, near: 10, far: 60000 }}
      gl={{ antialias: true }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#0D1319"]} />
      <hemisphereLight args={["#AFC2D8", "#141B22", 0.85]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[2600, 4200, 1800]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-5000}
        shadow-camera-right={5000}
        shadow-camera-top={5000}
        shadow-camera-bottom={-5000}
        shadow-camera-far={16000}
      />

      {/* chão e grade de 500 mm — a mesma linguagem visual da outra célula */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[26000, 26000]} />
        <meshStandardMaterial color="#7C838A" roughness={0.88} />
      </mesh>
      <Grid
        position={[0, 1, 0]}
        args={[26000, 26000]}
        cellSize={250}
        cellColor="#6A7178"
        sectionSize={500}
        sectionColor="#5B6268"
        fadeDistance={20000}
        fadeStrength={2}
      />

      <Esteira />
      <Portal />
      <Caixas />
      <Cotas />
      <CameraQueGira ativo={girar} />

      <OrbitControls
        target={[0, 900, 0]}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={1200}
        maxDistance={20000}
        enableDamping
      />
    </Canvas>
  );
}

export const Etiquetadora = memo(CenaEtiquetadora);
