import { createRoot } from "react-dom/client";
import { App, Bancada } from "./App";
import "./styles.css";

// A ESCOLHA DA CENA MORA AQUI, e não dentro do App.
//
// Desviar lá dentro exigiria um `return` antes dos hooks — e hook condicional
// é regra quebrada do React, mesmo quando "funciona" porque a URL não muda
// sem recarregar. Aqui são duas árvores independentes, e a cena em construção
// nem abre o WebSocket do supervisório.
const cena = new URLSearchParams(location.search).get("cena");

createRoot(document.getElementById("root")!).render(
  cena === "etiquetadora" ? <Bancada /> : <App />,
);
