import { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import { Context, SessionFlavor } from "grammy";
import { DateTime } from "luxon";
import { AccountSchema, ShipmentSchema } from "./validation";
import { z } from "zod";
import { ParseModeFlavor } from "@grammyjs/parse-mode";

export type SessionData = {};

export type AppContext = ParseModeFlavor<
  Context & ConversationFlavor & SessionFlavor<SessionData>
>;

export type AppConversation = Conversation<AppContext>;

export type Shipment = z.infer<typeof ShipmentSchema>;

export type BrowserSession = {
  headers: {
    cookie: string;
    "sec-ch-ua": string;
    "sec-ch-ua-mobile": string;
    "sec-ch-ua-platform": string;
  };
  username: string;
  customerId: string | null;
  userId: string | null;
  createdAt: string;
  balance: number | null;
  controlTotal: number | null;
};

export type Account = z.infer<typeof AccountSchema>;

export const ERRORS_MAP = {
  NO_ACCOUNTS_FOUND: "No accounts found!",
  NO_VALID_ACCOUNT: "No valid account found to process label",
  CANNOT_LOGIN: "Cannot login to Endicia",
  NO_SESSION_FOUND: "No session found!",
  LABEL_CREATION_FAILED: "Failed to create label",
  ERROR: "An error occured",
} as const;

type ERROR = keyof typeof ERRORS_MAP;

export class AccountError extends Error {
  type: ERROR = "ERROR";
  constructor(msg: string, type: ERROR) {
    super(msg);

    if (type) {
      this.type = type;
    }

    Object.setPrototypeOf(this, AccountError.prototype);
  }
}

export class FundingError extends Error {
  constructor(msg: any) {
    super(msg);

    Object.setPrototypeOf(this, AccountError.prototype);
  }
}

export type LabelJobData = {
  shipment: Shipment;
  labelId: string;
  chatId: number;
};

export interface ILabel {
  shipmentDate: Date;
  accountUsed: string;
  balanceUsed: number;
  shipmentType: string;
  fileId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionJobData = Pick<Account, "username" | "password">;

export type StampsCustomerInfo = {
  info: {
    CustomerID: number;
    MeterNumber: number;
    UserID: number;
    PostageBalance: {
      AvailablePostage: number;
      ControlTotal: number;
    };
    MaxPostageBalance: number;
    LPOCity: string;
    LPOState: string;
    LPOZip: string;
    AccountId: number;
    CorpID: number;
    StoreID: string;
    CostCodeLimit: number;
    MonthlyPostagePurchaseLimit: number;
    MaxUsers: number;
    Capabilities: any;
    MeterPhysicalAddress: {
      FirstName: string;
      MiddleName: string;
      LastName: string;
      Company: string;
      Address1: string;
      Address2: string;
      City: string;
      State: string;
      ZIPCode: string;
      ZIPCodeAddOn: string;
      Country: string;
      PhoneNumber: string;
      Extension: string;
    };
    ResubmitStatus: string;
    ResubmitCookie: string;
    PlanID: number;
    PendingPlanIdSpecified: boolean;
    Username: string;
    RatesetType: string;
    RatesetTypeSpecified: boolean;
    USPSRep: boolean;
    USPSRepSpecified: boolean;
    AutoBuySettings: {
      AutoBuyEnabled: boolean;
      PurchaseAmount: number;
      TriggerAmount: number;
    };
    RateToken: string;
    CustomerData: string;
    Terms: {
      [key: string]: boolean;
    };
    OutstandingLabelBalanceSpecified: boolean;
    MaxOutstandingLabelBalanceSpecified: boolean;
    Merchant: string;
    MeterProvider: string;
    MaxImageCount: number;
    SEApiToken: string;
    GAPickupCarrier: string;
    LocalCurrency: string;
    HasPOURMailerID: boolean;
    MaxParcelGuardInsuredValueSpecified: boolean;
    FacilityAssigned: boolean;
    GPPickupCarrier: string;
    MailingZipCode: string;
    BrandedExternalPrints: boolean;
    SubscriptionStatus: {
      AdminHold: boolean;
      Resubmit: boolean;
      ServiceFeesNotPaid: boolean;
      PaymentHold: boolean;
    };
  };
  address: {
    FirstName: string;
    MiddleName: string;
    LastName: string;
    Company: string;
    Address1: string;
    Address2: string;
    City: string;
    State: string;
    ZIPCode: string;
    ZIPCodeAddOn: string;
    Country: string;
    PhoneNumber: string;
    Extension: string;
  };
  customerEmail: string;
  accountStatus: string;
  verificationPhoneNumber: string;
  verificationPhoneExtension: string;
  dateAdvance: {
    MaxDateAdvanceEnvelope: number;
    MaxDateAdvanceMailingLabel: number;
    MaxDateAdvanceShippingLabel: number;
  };
  ErrorCode: number;
  ErrorDescription: string;
};
