import { closeBrowser } from "./appliers/browser.js";
import { runAppliers } from "./appliers/index.js";
import { adquirirTrava, liberarTrava } from "./lib/trava.js";

if (!adquirirTrava("appliers")) {
  console.error("[appliers] já existe uma execução em andamento — abortando");
  process.exit(1);
}

try {
  const resultado = await runAppliers();
  console.log("[appliers]", resultado);
} finally {
  await closeBrowser();
  liberarTrava("appliers");
}
