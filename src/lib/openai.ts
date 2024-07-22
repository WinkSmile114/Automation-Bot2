import OpenAI from "openai";
import { Shipment } from "./types";
import systemConfig from "../config";
import { ShipmentSchema } from "./validation";
import { z } from "zod";
import { formatZodErrors, removeJsonMdMarkers } from "../utils";

const openai = new OpenAI({
  apiKey: systemConfig.openAiApiKey,
  baseURL: "https://api.aimlapi.com/",
});

export async function extractLabelParameters({
  header,
  record,
}: {
  header: string;
  record: string;
}): Promise<Shipment> {
  const prompt = `Convert data from this context to JSON, only the sender's (from address), receivers part and USPS/UPS service type matters.
Header: ${header}
Record: ${record}

JSON format:
{
From: 
    {
      FullName: "",
      Company: "", (Optional),
      Address1: "",
      Address2: "", (Optional),
      Address3: "", (Optional),
      City: "",
      State: "", (Two letter US state abbreviation),
      ZIPCode: "91762",
      PhoneNumber: "", (Optional),
    },
To: {
"recipient_name": "", (Keep the name exactly as it is from excel data row)
"recipient_phone": "",
"recipient_postcode": "93710-3610" (Example),
"address1": "",
"address2": "",
"city": "",
"state": "", (Two letter US state abbreviation),
"weight_lb": 0.00, (Convert OZ to LBS, should be accurate)
"length_in": 0,
"width_in": 0,
"height_in": 0,
"mail_class":  ("USPM" for any USPS Priority Mail or "USGA" for any USPS ground)
}
`;

  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You a an expert data filler. your job is to replace a provided json structure with user input ensuring the data is placed correctly. 
          The provided data is usually in the format 
          SenderName	FromCompany	FromPhone	FromZip	FromAddress1	FromAddress2	FromCity	FromState	ToName	ToCompany	ToPhone	ToZip	ToAddress1	ToAddress2	ToCity	ToState	weightln(LB)	Length(in)	Height(in)	Width(in)
          Note that, certain values like FromCompany, FromAddress2, ToCompany, ToAddress2, Tracking number, might be missing. You should ignore them if they are not provided and interpret the data correctly.
          Your entire response/output is going to consist of a single JSON object {}, and you will NOT wrap it within JSON md markers`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 1280,
    response_format: { type: "json_object" },
  });

  let response = chatCompletion.choices[0].message.content || "{}";

  if (response.startsWith("```")) {
    response = removeJsonMdMarkers(response);
  }
  const parsed_label = parseResponse(response);

  return parsed_label;
}

export async function explainError(error: string): Promise<string> {
  try {
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You're a error descriptor, convert this programtical error message/code into human readable error message for end users, just send the message in your response.
            Error: ${error}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1280,
    });

    return chatCompletion.choices[0].message.content || "An error occured";
  } catch (err) {
    console.log(err);
    return "An error occured";
  }
}

function parseResponse(response: string): Shipment {
  try {
    const json = JSON.parse(response);
    const result = ShipmentSchema.safeParse(json);

    if (!result.success) {
      const formattedErrors = formatZodErrors(result.error);
      throw new Error(`Validation failed: ${JSON.stringify(formattedErrors)}`);
    }

    return result.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    } else if (error instanceof z.ZodError) {
      const formattedErrors = formatZodErrors(error);
      throw new Error(`Validation failed: ${JSON.stringify(formattedErrors)}`);
    } else {
      throw new Error(
        `Failed to create label parameters: ${(error as Error).message}`
      );
    }
  }
}
