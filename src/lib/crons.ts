import { CronJob } from "cron";
import systemConfig from "../config";
import { SessionJobData } from "./types";
import store from "./store";
import { logg } from "../utils";
import { addBalanceToAccount } from "./stamps";

async function addAccountsToSessionQueue() {
  await store.session.clearSessions();

  // add update sessions to the queue
  const accounts = await store.account.getAccounts();

  if (!accounts) {
    return;
  }

  const activeAccounts = accounts.filter((account) => account.enabled);

  logg(
    `Schelduing  jobs for ${activeAccounts.length} account${
      activeAccounts.length === 1 ? "" : "s"
    }`,
    {
      level: "info",
    }
  );

  for (const account of activeAccounts) {
    await systemConfig.sessionGenQueue
      .createJob(account as SessionJobData)
      .retries(1)
      .save();
  }
}

async function updateSessionBalance() {
  try {
    const sessions = await store.session.getSessions();

    // check the combined balance of the session should be >= $500
    const totalBalance = sessions.reduce(
      (acc, session) => acc + Number(session.balance),
      0
    );

    if (totalBalance >= 500) {
      return;
    }

    // Add random balance between $10-$500 for each session

    for (const session of sessions) {
      const randomBalance = Math.floor(Math.random() * (500 - 10 + 1)) + 10;

      try {
        await addBalanceToAccount(session, randomBalance);
      } catch (error) {
        logg(error, { level: "error" });
      }
    }
  } catch (error) {
    logg(error, { level: "error" });
  }
}

const updateSessionCronJob = CronJob.from({
  cronTime: "*/15 * * * *",
  onTick: addAccountsToSessionQueue,
});

// every 5 minutes
const updateSessionBalanceCronJob = CronJob.from({
  cronTime: "*/5 * * * *",
  onTick: updateSessionBalance,
});

const crons = {
  updateSessionCronJob,
  updateSessionBalanceCronJob,
  addAccountsToSessionQueue,
  updateSessionBalance,
};

export default crons;
