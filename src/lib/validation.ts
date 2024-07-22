import { z } from "zod";

export const ShipmentSchema = z.object({
  From: z.object({
    FullName: z.string(),
    Company: z.string().optional(),
    Address1: z.string(),
    Address2: z.string().optional(),
    Address3: z.string().optional(),
    City: z.string(),
    State: z.string(),
    ZIPCode: z.string(),
    PhoneNumber: z.string().optional(),
  }),
  To: z.object({
    recipient_name: z.string(),
    recipient_phone: z.string(),
    recipient_postcode: z.string(),
    address1: z.string(),
    address2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    weight_lb: z.number(),
    length_in: z.number(),
    width_in: z.number(),
    height_in: z.number(),
    mail_class: z.string(),
  }),
});

export const AccountSchema = z.object({
  username: z.string(),
  password: z.string(),
  enabled: z.boolean().default(true),
});
