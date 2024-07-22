import { DateTime } from "luxon";
import store from "./store";
import { AppContext, AppConversation, LabelJobData } from "./types";
import { extractLabelParameters } from "./openai";
import systemConfig from "../config";
import axios from "axios";
import { parse } from "csv/sync";

export async function requestLabelDetails(
  conversation: AppConversation,
  ctx: AppContext
) {
  if (!ctx.chat?.id || ctx.message?.from.is_bot) {
    return;
  }

  await ctx.reply(
    "You can type `cancel` to cancel the process\nUpload a csv with the label records\\:",
    { parse_mode: "MarkdownV2" }
  );

  const fileCtx = await conversation.wait();

  if (fileCtx.message?.text === "cancel") {
    await ctx.reply("Cancelled the process");
    return;
  }

  const file = await fileCtx.getFile();

  if (!(fileCtx.message?.document?.mime_type === "text/csv")) {
    await ctx.reply("Please upload a csv file");
    return;
  }
  
  const csv = await conversation.external(async () => {
    const response = await axios.get(
      `https://api.telegram.org/file/bot${systemConfig.botToken}/${file.file_path}`
    );

    return response.data;
  });

  const [headers, ...records] = parse(csv, {
    columns: false,
    skip_empty_lines: true,
  });
  const processedRecords: string[] = records.map((record: string[][]) =>
    record.join(" ")
  );

  ctx.reply(`Processing ${processedRecords.length} records, please wait...`);

  for (let record of processedRecords) {
    const shipment = await conversation.external(async () => {
      const shipment = await extractLabelParameters({
        header: headers.join(" "),
        record,
      });

      return shipment;
    });

    const jobData: LabelJobData = {
      shipment,
      labelId: `${shipment.From.FullName.toLowerCase().replace(
        " ",
        "_"
      )}-${DateTime.now().toFormat("ff")}`,
      chatId: ctx.chat?.id,
    };

    const job = await conversation.external(async () => {
      const job = await systemConfig.labelGenQueue.createJob(jobData).save();
      return job;
    });

    await ctx.reply(
      `Process queued for label ${jobData.labelId}\nJob ID: ${job.id}`
    );
  }
}

export const accountsCallback = async (ctx: AppContext) => {
  const accounts = await store.account.getAccounts();
  const session = await store.session.getActiveSession();

  if (!accounts) {
    await ctx.reply("No accounts found, please add an account");
    return;
  }

  const reply = accounts.map((account) => {
    return `${account.username} - ${account.enabled ? "Enabled" : "Disabled"}${
      session?.username === account.username ? " - Active" : ""
    }`;
  });

  await ctx.reply("Accounts\n" + reply.join("\n"));
};
