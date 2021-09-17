import { spawnSync } from "child_process"
import { resolve, dirname } from "path"
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Say our "real" entrance script is `app.js`
const cmd = "node --no-warnings " + resolve(__dirname, "../index.js");
spawnSync(cmd, { stdio: "inherit", shell: true });
