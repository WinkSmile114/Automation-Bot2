import { DateTime } from "luxon";
import systemConfig from "../config";
import { logg } from "../utils";
import store from "./store";
import { AppContext, LabelJobData, SessionJobData } from "./types";
import { InputFile, type Api, type Bot, type RawApi } from "grammy";
import { getStampsSession, printLabelFromSession } from "./stamps";
import { italic } from "@grammyjs/parse-mode";
import { explainError } from "./openai";

function setupLabelGenQueue(bot: Bot<AppContext, Api<RawApi>>) {
  systemConfig.labelGenQueue.process(async (job) => {
    logg("Processing job", { level: "info" });
    const data: LabelJobData = job.data;

    let session = await store.session.getActiveSession();

    if (!session) {
      await bot.api.sendMessage(
        data.chatId,
        "No active session found, please try again later"
      );
      return;
    }

    try {
      const [buffer, filename] = await printLabelFromSession(
        data.shipment,
        session!
      );
      const file = new InputFile(buffer, filename);

      await store.label.addLabel({
        shipmentDate: DateTime.utc().toJSDate(),
        accountUsed: session!.username,
        balanceUsed: 0,
        shipmentType: "",
        fileId: filename,
        createdAt: DateTime.utc().toJSDate(),
        updatedAt: DateTime.utc().toJSDate(),
      });

      await bot.api.sendDocument(data.chatId, file, {
        caption: `${italic(data.labelId)}-${italic(filename)}\n${italic(
          `Label Generated - ${DateTime.now().toFormat("ff")}`
        )}`,
      });

      return;
    } catch (error: any) {
      const errorExplanation = await explainError(error.message);
      await bot.api.sendMessage(data.chatId, String(`Account used: ${session?.username}\n${errorExplanation}`));
      logg(error.message, { level: "error" });
    }
  });
}

function setupSessionGenQueue() {
  systemConfig.sessionGenQueue.process(async (job) => {
    const data: SessionJobData = job.data;
    logg(`Processing session job - ${data.username}`, { level: "info" });

    try {
      const session = await getStampsSession(data.username, data.password);

      store.session.setSession(data.username, session);
    } catch (error: any) {
      logg(error.message, { level: "error" });
    }
  });
}

const jobQueues = {
  setupLabelGenQueue,
  setupSessionGenQueue,
};

export default jobQueues;
