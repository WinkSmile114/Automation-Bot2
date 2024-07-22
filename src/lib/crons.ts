import { CronJob } from "cron";
import systemConfig from "../config";
import { SessionJobData } from "./types";
import store from "./store";
import { logg } from "../utils";

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
      .save();
  }
}

const updateSessionCronJob = CronJob.from({
  cronTime: "*/15 * * * *",
  onTick: addAccountsToSessionQueue,
});

const crons = {
  updateSessionCronJob,
  addAccountsToSessionQueue,
};

export default crons;
