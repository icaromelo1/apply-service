import { closeBrowser } from "./appliers/browser.js";
import { runAppliers } from "./appliers/index.js";

const resultado = await runAppliers();
console.log("[appliers]", resultado);
await closeBrowser();
