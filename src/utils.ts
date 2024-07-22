import chalk from "chalk";
import crypto from "node:crypto";
import { z } from "zod";
import systemConfig from "./config";
import { HttpsProxyAgent } from "https-proxy-agent";
import axios from "axios";
import { BrowserSession } from "./lib/types";

/**
 * Wait some milliseconds
 * @param ms milliseconds
 * @returns
 */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function logg(
  message: any,
  config: { level?: "error" | "info" | "warn"; exit?: boolean } = {
    level: "info",
  }
) {
  if (config.level === "error") {
    console.log(chalk.redBright("ERROR: " + message));
    if (config.exit) process.exit(1);
  } else if (config.level === "warn") {
    console.log(chalk.yellowBright("WARN: " + message));
  } else {
    console.log(chalk.gray("INFO: ", message));
  }
}

export function getRandomString(length: number) {
  return crypto.randomBytes(length).toString("hex");
}

export function getRandomNumber(minimum: number, maximum: number): number {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

export function formatZodErrors(error: z.ZodError): Record<string, string> {
  return error.issues.reduce((acc, issue) => {
    const path = issue.path.join(".");
    acc[path] = issue.message;
    return acc;
  }, {} as Record<string, string>);
}

export function removeJsonMdMarkers(str: string) {
  // Remove ```json, ```jsonc, ``` at the start and end
  return str.replace(/```jsonc?\n|```/g, "").trim();
}

export function constructAxiosInstance(headers?: BrowserSession["headers"]) {
  const agent = systemConfig.useProxy
    ? new HttpsProxyAgent<string>(
        `http://${systemConfig.proxyUsernamePassword?.toString()}@${systemConfig.proxyIpPort?.toString()}`
      )
    : undefined;

  const axiosInstance = axios.create({
    httpsAgent: agent,
    headers: {
      ...headers,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
      Referer: "https://print.stamps.com/",
      "Referrer-Policy": "strict-origin",
    },
  });

  return axiosInstance;
}
