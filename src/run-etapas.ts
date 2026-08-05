import { resolverEtapasGupy } from "./appliers/gupy-etapas.js";
import { closeBrowser } from "./appliers/browser.js";
import { adquirirTrava, liberarTrava } from "./lib/trava.js";

const ignorarCooldown = process.argv.includes("--forcar");

if (!adquirirTrava("appliers")) {
  console.error("[etapas] já existe uma execução em andamento");
  process.exit(1);
}

try {
  const resultado = await resolverEtapasGupy({ ignorarCooldown });
  console.log("[etapas]", resultado);
} finally {
  await closeBrowser().catch(() => {});
  liberarTrava("appliers");
}
