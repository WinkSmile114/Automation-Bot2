import systemConfig from "./config";
import { Bot, InlineKeyboard, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { AppContext } from "./lib/types";
import { logg } from "./utils";
import { accountsCallback, requestLabelDetails } from "./lib/callbacks";
import store from "./lib/store";
import crons from "./lib/crons";
import jobQueues from "./lib/jobs-queues";
import { DateTime } from "luxon";

const bot = new Bot<AppContext>(systemConfig.botToken);

bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(requestLabelDetails, "create-label-conversation"));

bot.command("stats", async (ctx) => {
  await ctx.reply("Getting stats now, please be patient");
});

bot.command("accounts", accountsCallback);

const inlineKeyboard = new InlineKeyboard().text(
  "Create a label",
  "create-label-button"
);

bot.command("start", (ctx) =>
  ctx.reply("Welcome! what do you want to do today?", {
    reply_markup: inlineKeyboard,
  })
);

bot.command("add_account", async (ctx) => {
  // use regex to check the account is in the format username:password
  const account = ctx.message?.text?.split(" ")[1];

  console.log(account);

  const [username, ...rest] = account?.split(":") || [];
  const password = rest.join(":");

  if (!username || !password) {
    await ctx.reply("Invalid account format");
    return;
  }

  await store.account.addAccount(username, password);
  await ctx.reply(`Account ${username} added`);
});

bot.command("sessions", async (ctx) => {
  const sessions = await store.session.getSessions();

  if (sessions.length > 0) {
    await ctx.reply(
      `${sessions
        .map(
          (sess) =>
            // `${sess.username}: ${
            //   DateTime.fromISO(sess.createdAt).diffNow().minutes
            // }mins`
            `${sess.username} - ${DateTime.fromISO(sess.createdAt).toFormat(
              "ff"
            )} `
        )
        .join("\n")}`
    );
  } else {
    await ctx.reply(
      `No sessions in store.\nWait a few mins for the scheduler to fetch some sessions`
    );
  }
});

bot.command("clear_sessions", async (ctx) => {
  await store.session.clearSessions();

  ctx.reply(`Sessions cleared`);
});

bot.callbackQuery("create-label-button", async (ctx) => {
  await ctx.conversation.enter("create-label-conversation");
});

bot.catch((err) => {
  logg(err, { level: "error" });
});

systemConfig.redisClient
  .connect()
  .then(async () => {
    logg("Connected to Redis", { level: "info" });
    await store.account.loadAccounts();
    jobQueues.setupLabelGenQueue(bot);
    jobQueues.setupSessionGenQueue();
  })
  .catch((err) => {
    logg("Failed to connect to Redis", { level: "error" });
    logg(err, { level: "error", exit: true });
  })
  .finally(async () => {
    // await crons.addAccountsToSessionQueue();
    await crons.updateSessionBalance();
    crons.updateSessionCronJob.start();
    bot.start();
    logg("Bot running!!!");
  });

// Documentaion
// This code is a telegram bot that generates labels for shipments. It uses the grammy library to interact with the telegram API. The bot has several commands and callbacks that allow users to add accounts, set an active account, add balance to an account, and create labels for shipments. The bot also uses a queue to process label generation jobs in the background.
// # Commands
// - `/stats`: Get bot statistics
// 