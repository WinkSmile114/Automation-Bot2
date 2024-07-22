import { config } from "dotenv";
import { logg } from "./utils";
import { createClient } from "redis";
import Queue from "bee-queue";

config();

const osUser = process.env.OS_USER;
const botToken = process.env.BOT_TOKEN;
const openAiApiKey = process.env.OPENAI_KEY;
const cachePath = `/home/${osUser}/.cache/google-chrome`;
const debugPort = process.env.DEBUG_PORT;
const useProxy = Boolean(process.env.USE_PROXY);
const proxyIpPort = process.env.PROXY_IP_PORT;
const proxyUsernamePassword = process.env.PROXY_USERNAME_PASSWORD;
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) logg("Missing env REDIS_URL!", { level: "error", exit: true });

const redisClient = createClient({ url: redisUrl });

if (!osUser)
  logg("Missing env OS_USER for system user!", { level: "error", exit: true });

if (!botToken) logg("Missing env BOT_TOKEN!", { level: "error", exit: true });

if (!openAiApiKey)
  logg("Missing env OPENAI_KEY", { level: "error", exit: true });

if (useProxy && (!proxyIpPort || !proxyUsernamePassword))
  logg(
    "USE_PROXY is set but one of PROXY_IP_PORT, PROXY_USERNAME_PASSWORD is missing!",
    { level: "error", exit: true }
  );

if (!debugPort)
  logg("DEBUG_PORT not set, using default 9222", { level: "warn" });

const labelGenQueue = new Queue("label-gen", {
  redis: { url: redisUrl },
});

const sessionGenQueue = new Queue("session-gen", {
  redis: { url: redisUrl },
  removeOnFailure: true,
});

labelGenQueue.on("ready", () => {
  logg("Label Queue ready", { level: "info" });
});
labelGenQueue.on("error", (error) => {
  logg("Label Queue error", { level: "error" });
});

sessionGenQueue.on("ready", () => {
  logg("Session Queue ready", { level: "info" });
});
sessionGenQueue.on("error", (error) => {
  logg("Session Queue error", { level: "error" });
});

const systemConfig = {
  osUser: osUser!,
  botToken: botToken!,
  openAiApiKey: openAiApiKey!,
  cachePath,
  debugPort: parseInt(debugPort || "9222"),
  useProxy,
  proxyIpPort,
  proxyUsernamePassword,
  redisClient,
  labelGenQueue,
  sessionGenQueue,
};

export default systemConfig;
