import { readFileSync } from "fs";
import { Account, AccountError, BrowserSession, ILabel } from "./types";
import { formatZodErrors, logg } from "../utils";
import { AccountSchema } from "./validation";
import { z } from "zod";
import systemConfig from "../config";
import { DateTime } from "luxon";
import Label from "../models/label";

async function loadAccounts() {
  try {
    const localAccounts = readFileSync("data/accounts.json", "utf-8");
    const AccountsArraySchema = z.array(AccountSchema);
    const result = AccountsArraySchema.safeParse(JSON.parse(localAccounts));

    if (!result.success) {
      const formattedErrors = formatZodErrors(result.error);
      logg(formattedErrors, { level: "error", exit: true });
    }

    if (!result.data) {
      throw new Error("No accounts found!");
    }

    logg("Loaded initial accounts", { level: "info" });

    await systemConfig.redisClient.set("accounts", JSON.stringify(result.data));

    return result.data;
  } catch (error) {
    logg(
      "Error loading initial accounts, add at least 1 account in data/accounts.json as valid JSON array!",
      { level: "error", exit: true }
    );
  }
}

async function getSessions() {
  const sessions = await systemConfig.redisClient.get(`sessions`);

  if (!sessions) {
    logg("No session found!", { level: "error" });
  }

  return sessions ? (JSON.parse(sessions) as BrowserSession[]) : [];
}

async function setSession(username: string, session: BrowserSession) {
  const sessions = await getSessions();

  if (sessions.some((session) => session.username === username)) {
    // update session
    const updatedSessions = sessions.map((sess) => {
      if (sess.username === username) {
        return session;
      }
      return sess;
    });

    await systemConfig.redisClient.set(
      `sessions`,
      JSON.stringify(updatedSessions)
    );

    return session;
  }

  await systemConfig.redisClient.set(
    `sessions`,
    JSON.stringify([...sessions, session])
  );

  return session;
}

async function deleteSession(username: string) {
  const sessions = await getSessions();

  if (!sessions) {
    logg("No session found!", { level: "error" });
  }

  const updatedSessions = sessions.filter(
    (session) => session.username !== username
  );

  await systemConfig.redisClient.set("sessions", JSON.stringify(updatedSessions));
}

async function clearSessions() {
  await systemConfig.redisClient.set("sessions", JSON.stringify([]));
}

async function getActiveSession() {
  const sessions = await getSessions();

  if (!sessions) {
    logg("No session found!", { level: "error" });
  }

  const sortedSessions = sessions.sort(
    (a, b) =>
      DateTime.fromISO(b.createdAt).toMillis() -
      DateTime.fromISO(a.createdAt).toMillis()
  );

  // check if session is still valid by checking if the time is less than 5 mins
  const activeSession = sortedSessions.find(
    (sess) => DateTime.fromISO(sess.createdAt).diffNow().as("minutes") < 5
  );

  if (!activeSession) {
    logg("No active session found!", { level: "error" });
  }

  return activeSession;
}

async function getAccount(username?: string) {
  const accounts = await systemConfig.redisClient.get("accounts");

  if (!accounts) {
    logg("No accounts found!", { level: "error", exit: true });
    return;
  }

  const accountsArray = JSON.parse(accounts) as Account[];

  const account = username
    ? accountsArray.find((acc) => acc.username === username)
    : accountsArray.find((acc) => acc.enabled === true);

  return account;
}

async function getAccounts() {
  const accounts = await systemConfig.redisClient.get("accounts");

  if (!accounts) {
    logg("No accounts found!", { level: "error" });
    return [];
  }

  return JSON.parse(accounts) as Account[];
}

async function addAccount(username: string, password: string) {
  const accounts = await systemConfig.redisClient.get("accounts");

  if (!accounts) {
    logg("No accounts found!", { level: "error" });
    return;
  }

  const accountsArray = JSON.parse(accounts) as Account[];

  const newAccount: Account = { username, password, enabled: true };

  await systemConfig.redisClient.set(
    "accounts",
    JSON.stringify([...accountsArray, newAccount])
  );
}

async function deleteAccount(username: string) {
  const accounts = await systemConfig.redisClient.get("accounts");

  if (!accounts) {
    logg("No accounts found!", { level: "error", exit: true });
    return;
  }

  const accountsArray = JSON.parse(accounts) as Account[];

  await systemConfig.redisClient.set(
    "accounts",
    JSON.stringify(
      accountsArray.filter((acc: Account) => acc.username !== username)
    )
  );
}

async function disableAccount(username: string) {
  const accounts = await systemConfig.redisClient.get("accounts");

  if (!accounts) {
    logg("No accounts found!", { level: "error" });
    return;
  }

  const accountsArray = JSON.parse(accounts) as Account[];

  await systemConfig.redisClient.set(
    "accounts",
    JSON.stringify(
      accountsArray.map((acc: Account) =>
        acc.username === username ? { ...acc, enabled: false } : acc
      )
    )
  );
}

async function rotateAccount(username: string) {
  await disableAccount(username);

  return getAccount();
}

async function getStats(day: DateTime) {
  // from day till today
  // Number of shipments, accounts used, balance used, number of shipment types.

  const labels = await Label.find({
    createdAt: {
      $gte: day.startOf("day").toJSDate(),
      $lt: DateTime.now().toJSDate(),
    },
  });

  const stats = {
    numberOfShipments: labels.length,
    accountsUsed: labels.map((label) => label.accountUsed).length,
    balanceUsed: labels
      .map((label) => label.balanceUsed)
      .reduce((a, b) => a + b, 0),
    shipmentTypes: labels.map((label) => label.shipmentType).length,
  };

  return stats;
}

async function addLabel(data: ILabel) {
  const label = new Label(data);

  const saved = await label.save();

  return saved.toJSON();
}

const store = {
  session: {
    getSessions,
    getActiveSession,
    setSession,
    deleteSession,
    clearSessions,
  },

  account: {
    getAccount,
    getAccounts,
    addAccount,
    deleteAccount,
    disableAccount,
    rotateAccount,
    loadAccounts,
  },

  label: {
    addLabel,
    getStats,
  },
};

export default store;
