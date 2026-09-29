const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const NGROK_VERSION = "4.3.3";
const DEFAULT_WEB_PORT = Number(process.env.NGROK_WEB_PORT || 4041);

let ngrokProcess = null;
let startupPromise = null;
let cleanupRegistered = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNpxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function getLocalNgrokCommand(projectRoot) {
  const binaryName = process.platform === "win32" ? "ngrok.cmd" : "ngrok";
  const binaryPath = path.join(projectRoot, "node_modules", ".bin", binaryName);
  return fs.existsSync(binaryPath) ? binaryPath : null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";

      response.on("data", (chunk) => {
        body += chunk;
      });

      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 400) {
          return reject(new Error(`Request failed with status ${response.statusCode}`));
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
  });
}

async function waitForPublicUrl(webPort, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const data = await fetchJson(`http://127.0.0.1:${webPort}/api/tunnels`);
      const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
      const httpsTunnel = tunnels.find((tunnel) => tunnel.public_url && tunnel.public_url.startsWith("https://"));
      const fallbackTunnel = tunnels.find((tunnel) => tunnel.public_url);

      if (httpsTunnel) return httpsTunnel.public_url;
      if (fallbackTunnel) return fallbackTunnel.public_url;
    } catch (error) {
      // ngrok may not have finished booting yet.
    }

    await delay(1000);
  }

  throw new Error("Timed out while waiting for the ngrok public URL.");
}

function writeMobileEnv(projectRoot, publicUrl) {
  const mobileDir = path.join(projectRoot, "mobile-patient-app");
  if (!fs.existsSync(mobileDir)) return;

  const envPath = path.join(mobileDir, ".env.development.local");
  fs.writeFileSync(envPath, `EXPO_PUBLIC_API_URL=${publicUrl}\n`, "utf8");
  console.log(`Mobile API URL saved to ${path.relative(projectRoot, envPath)}`);
}

function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    if (ngrokProcess && !ngrokProcess.killed) {
      ngrokProcess.kill();
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

function startNgrok({ port, projectRoot }) {
  if (startupPromise) return startupPromise;

  startupPromise = (async () => {
    if (String(process.env.DISABLE_NGROK || "false").toLowerCase() === "true") {
      console.log("Ngrok auto-start is disabled via DISABLE_NGROK=true.");
      return null;
    }

    const localCommand = getLocalNgrokCommand(projectRoot);
    const command = localCommand || getNpxCommand();
    const args = localCommand
      ? ["http", String(port), "--log", "stdout", "--web-addr", `127.0.0.1:${DEFAULT_WEB_PORT}`]
      : [
          "--yes",
          `ngrok@${NGROK_VERSION}`,
          "http",
          String(port),
          "--log",
          "stdout",
          "--web-addr",
          `127.0.0.1:${DEFAULT_WEB_PORT}`,
        ];

    if (process.env.NGROK_AUTHTOKEN) {
      args.push("--authtoken", process.env.NGROK_AUTHTOKEN);
    }

    if (process.env.NGROK_REGION) {
      args.push("--region", process.env.NGROK_REGION);
    }

    if (process.env.NGROK_DOMAIN) {
      args.push("--domain", process.env.NGROK_DOMAIN);
    }

    console.log(`Starting ngrok for port ${port}...`);
    if (!process.env.NGROK_AUTHTOKEN) {
      console.warn("NGROK_AUTHTOKEN is not set. Add it to .env if ngrok authentication is required.");
    }

    ngrokProcess = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    registerCleanup();

    ngrokProcess.stdout.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message && /(lvl=error|error|failed|authentication|ERR_NGROK)/i.test(message)) {
        console.log(`[ngrok] ${message}`);
      }
    });

    ngrokProcess.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) {
        console.log(`[ngrok] ${message}`);
      }
    });

    ngrokProcess.on("exit", (code) => {
      if (code && code !== 0) {
        console.warn(`ngrok exited with code ${code}.`);
      }
    });

    const publicUrl = await waitForPublicUrl(DEFAULT_WEB_PORT);
    console.log(`Ngrok public URL: ${publicUrl}`);
    writeMobileEnv(projectRoot, publicUrl);
    return publicUrl;
  })().catch((error) => {
    console.warn(`Ngrok could not be started automatically: ${error.message}`);
    return null;
  });

  return startupPromise;
}

module.exports = {
  startNgrok,
};
