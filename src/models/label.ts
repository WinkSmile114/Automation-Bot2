import { Schema, model } from "mongoose";
import { ILabel } from "../lib/types";

const labelSchema = new Schema<ILabel>(
  {
    shipmentDate: { type: Date, required: true },
    accountUsed: { type: String, required: true },
    balanceUsed: { type: Number, required: true },
    shipmentType: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

const Label = model<ILabel>("Label", labelSchema);

export default Label;
