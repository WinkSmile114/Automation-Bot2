import puppeteer from "puppeteer-extra";
import {
  CDPSession,
  DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
  Page,
} from "puppeteer";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import anonymizeUAPlugin from "puppeteer-extra-plugin-anonymize-ua";
import blockResourcesPlugin from "puppeteer-extra-plugin-block-resources";
import chalk from "chalk";
import fs, { writeFileSync } from "fs";
import { rimrafSync } from "rimraf";
import {
  CHROME_PATHS,
  SELECTORS,
  TARGET_URL_BASE,
  TARGET_URL_LOGIN,
  URLBlockPatterns,
} from "../constants";
import { constructAxiosInstance, getRandomNumber, logg, sleep } from "../utils";
import systemConfig from "../config";
import path from "path";
import { DateTime } from "luxon";
import {
  AccountError,
  BrowserSession,
  ERRORS_MAP,
  FundingError,
  Shipment,
  StampsCustomerInfo,
} from "./types";
import store from "./store";

const browserProfile = path.join(
  systemConfig.cachePath,
  "label_bot_92876462783"
); // There's no need to always change the browser profile. We can use the same profile and clear cookies

function getActiveChromePath() {
  for (const chromePath of CHROME_PATHS) {
    try {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    } catch (error) {
      console.warn(chalk.yellow("Google chrome is not installed."));
    }
  }

  return;
}

export async function setupBlockedResources(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    const url = request.url().toLowerCase();
    const shouldBlock = URLBlockPatterns.some((pattern) => {
      const regexPattern = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      return regexPattern.test(url);
    });

    if (shouldBlock) {
      request.abort();
    } else {
      request.continue();
    }
  });
}

async function bringPageToFront(page: Page) {
  try {
    await page.bringToFront();
  } catch (error) {
    console.log(chalk.gray("Warning: Failed to bring to front."));
  }
}

function getBrowserArgs() {
  const useProxy = systemConfig.useProxy;
  const proxyOption = useProxy
    ? `--proxy-server=${systemConfig.proxyIpPort}`
    : null;

  const options = [
    `--remote-debugging-port=${systemConfig.debugPort}`,
    "--ignoreHTTPSErrors=true",
    "--disable-geolocation",
    "--disable-plugins-discovery",
    "--start-maximized",
    "--disable-extensions",
    "--disable-infobars",
    "--no-first-run",
    "--disable-breakpad",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-sync",
    "--mute-audio",
    "--disable-logging",
    "--incognito",
    `--user-data-dir=${browserProfile}`,
  ];

  if (proxyOption) {
    options.push(proxyOption);
  }

  return options;
}

async function resetBrowserSession(client: CDPSession) {
  await client.send("Network.clearBrowserCookies");
  await client.send("Network.clearBrowserCache");
}

export async function getStampsSession(
  username: string,
  password: string
): Promise<BrowserSession> {
  puppeteer.use(anonymizeUAPlugin());
  puppeteer.use(stealthPlugin());

  puppeteer.use(
    blockResourcesPlugin({
      blockedTypes: new Set(["image", "stylesheet", "media", "other"]),
      interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
  );

  // logg(`Getting session with profile - ${browserProfile}`);

  const chromePath = getActiveChromePath();

  const browserArgs = getBrowserArgs();

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: null,
    args: browserArgs,
  });

  let accountInfo: StampsCustomerInfo | null = null;

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(TARGET_URL_BASE, []);

    const pages = await browser.pages();
    const page = pages.length ? pages[0] : await browser.newPage();

    if (systemConfig.useProxy) {
      const [username, password] =
        systemConfig.proxyUsernamePassword!.split(":");

      await page.authenticate({
        username,
        password,
      });
    }
    const client = await page.createCDPSession();

    // Set random geolocation
    await page.evaluateOnNewDocument(function () {
      navigator.geolocation.getCurrentPosition = function (callBack) {
        setTimeout(() => {
          callBack({
            coords: {
              accuracy: 21,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              latitude: Math.random() * 180 - 90,
              longitude: Math.random() * 360 - 180,
              speed: null,
            },
            timestamp: DateTime.utc().toMillis(),
          });
        }, 1000);
      };
    });

    await page.setRequestInterception(true);

    await setupBlockedResources(page);

    await resetBrowserSession(client);

    page.setDefaultNavigationTimeout(120 * 1000);

    await page.goto(TARGET_URL_LOGIN, {
      waitUntil: "load",
      timeout: 140 * 1000,
    });

    await page.waitForSelector(SELECTORS.USERNAME_INPUT, {
      timeout: 40 * 1000,
    });
    await page.waitForSelector(SELECTORS.PASSWORD_INPUT, {
      timeout: 40 * 1000,
    });

    await sleep(getRandomNumber(1000, 1200));
    await page.click(SELECTORS.USERNAME_INPUT);
    await sleep(getRandomNumber(100, 200));
    await page.type(SELECTORS.USERNAME_INPUT, username, {
      delay: getRandomNumber(60, 350),
    });
    await sleep(getRandomNumber(1000, 1500));

    await page.click(SELECTORS.PASSWORD_INPUT);
    await sleep(getRandomNumber(100, 200));
    await page.type(SELECTORS.PASSWORD_INPUT, password, {
      delay: getRandomNumber(60, 350),
    });

    await sleep(getRandomNumber(1000, 1500));

    await bringPageToFront(page);

    await page.click(SELECTORS.LOGIN_BUTTON);
    await sleep(getRandomNumber(150, 1200));

    await page.waitForNetworkIdle({ timeout: 140 * 1000 });

    // Get cookies from the page
    const cookies = await page.cookies();
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    const userInfoValue = cookies.find(
      (cookie) => cookie.name === "user-info"
    )?.value;
    const custidMatch = userInfoValue?.match(/custid=([^&]*)/);
    const uidMatch = userInfoValue?.match(/uid=([^&]*)/);

    const custid = custidMatch ? custidMatch[1] : null;
    const uid = uidMatch ? uidMatch[1] : null;

    if (!uid) {
      await resetBrowserSession(client);
      await browser.close();

      await store.account.deleteAccount(username);
      await store.session.deleteSession(username);

      const clearedProfile = rimrafSync(browserProfile);
      if (clearedProfile) logg("Cleared browser profile");
      throw new AccountError(
        `${ERRORS_MAP.CANNOT_LOGIN}: ${username}`,
        "CANNOT_LOGIN"
      );
    }

    await browser.close();

    const headers = {
      cookie: cookieHeader,
      "sec-ch-ua": '"Brave";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
      "sec-ch-ua-platform": '"Linux"',
      "sec-ch-ua-mobile": "?0",
    };
    const accountInfo = await fetchAccountInfo(headers);

    const session: BrowserSession = {
      headers,
      username,
      customerId: custid,
      userId: uid,
      createdAt: DateTime.utc().toISO(),
      balance: accountInfo?.info.PostageBalance.AvailablePostage || null,
      controlTotal: accountInfo?.info.PostageBalance.ControlTotal || null,
    };

    logg(`Fetched session for ${username}-${session.userId}`);

    return session;
  } catch (error) {
    await browser.close(); // close browser if before throwing error
    throw error;
  }
}

/**
 *
 * @param shipment
 * @param sessionCustomerId
 * @returns
 */
function generatePayload(shipment: Shipment, sessionCustomerId: string | null) {
  return {
    costCodeID: 0,
    CustomerID: sessionCustomerId,
    Customs: "",
    deliveryNotification: false,
    EltronPrinterDPType: "Default",
    integratorTxId: "00000000-0000-0000-0000-000000000000",
    keepUrlSplit: true,
    labelColumn: 1,
    labelRow: 1,
    Reference1: "",
    memo: "",
    printMemo: false,
    NonDeliveryOption: "Return",
    OrderID: "",
    printerName: null,
    printerOrientation: "portrait",
    printerTray: null,
    printInstructions: false,
    PrintLayout: "Normal4X6",
    recipientEmail: "",
    rotationDegrees: 0,
    SampleOnly: false,
    TrackingNumber: "",
    verticalOffset: 0,
    ImageType: "EncryptedPngUrl",
    ReturnTo: {
      FullName: shipment.From.FullName,
      Company: shipment.From.Company,
      Address1: shipment.From.Address1,
      Address2: shipment.From.Address2,
      Address3: shipment.From.Address3,
      City: shipment.From.City,
      State: shipment.From.State,
      ZIPCode: shipment.From.ZIPCode,
      PhoneNumber: shipment.From.PhoneNumber,
      CleanseHash: "",
      OverrideHash: "",
    },
    Rate: {
      From: {
        FullName: shipment.From.FullName,
        Company: shipment.From.Company,
        Address1: shipment.From.Address1,
        Address2: shipment.From.Address2,
        Address3: shipment.From.Address3,
        City: shipment.From.City,
        State: shipment.From.State,
        ZIPCode: shipment.From.ZIPCode,
        PhoneNumber: shipment.From.PhoneNumber,
        CleanseHash: "",
        OverrideHash: "",
      },
      To: {
        FullName: shipment.To.recipient_name,
        Company: "",
        PhoneNumber: shipment.To.recipient_phone,
        Address1: shipment.To.address1,
        Address2: shipment.To.address2,
        Address3: "",
        City: shipment.To.city,
        Country: "US",
        freeFormAddress: `${shipment.To.recipient_name}\n${
          shipment.To.address1
        }\n${shipment.To.city}, ${shipment.To.state.toUpperCase()} ${
          shipment.To.recipient_postcode
        }`,
        CleanseMessage: "Cleansed",
        CleanseHash: "",
        OverrideHash: "",
        EmailAddress: "",
        State: shipment.To.state.toUpperCase(),
        ZIPCode: shipment.To.recipient_postcode.split("-")[0],
        ZIPCodeAddOn: shipment.To.recipient_postcode.split("-")[1] || "",
      },
      Amount: 8.62,
      ServiceType: shipment.To.mail_class,
      DeliverDays: null,
      Error: null,
      WeightLb: shipment.To.weight_lb,
      WeightOz: 0,
      PackageType: "Package",
      ShipDate: new Date().toISOString().split("T")[0],
      ShipDateSpecified: true,
      InsuredValue: 0,
      RegisteredValue: 0,
      CODValue: 0,
      DeclaredValue: 1,
      RectangularShaped: true,
      Prohibitions: null,
      Restrictions: null,
      Observations: null,
      Regulations: null,
      GEMNotes: null,
      MaxDimensions: null,
      DimWeighting: null,
      AddOns: [
        {
          AddOnType: "SCAHP",
          Amount: 0,
        },
        {
          AddOnType: "USADC",
          Amount: 0,
        },
      ],
      EffectiveWeightInOunces: 0,
      IsIntraBMC: false,
      Zone: 0,
      RateCategory: 0,
      NonMachinable: false,
      Length: shipment.To.length_in,
      Width: shipment.To.width_in,
      Height: shipment.To.height_in,
      PrintLayout: "Normal4X6",
    },
    printerPaperHeight: 6,
    printerPaperWidth: 4,
  };
}

/**
 *
 * @param shipment
 * @param sessionId
 * @returns
 */
export async function printLabelFromSession(
  shipment: Shipment,
  session: BrowserSession
): Promise<[Buffer, string]> {
  const payload = generatePayload(shipment, session?.customerId);

  const axiosInstance = constructAxiosInstance(session.headers);

  // Step 1: Create Indicium
  const createIndiciumResponse = await axiosInstance.post(
    "https://print.stamps.com/WebPostage/Ajax/CreateIndicium.aspx?env=WebPostage",
    JSON.stringify(payload)
  );

  const createIndiciumData = createIndiciumResponse.data;

  if (!createIndiciumData.URL) {
    logg(
      `No URL returned while generating label, error: ${JSON.stringify(
        createIndiciumData
      )}`,
      { level: "error" }
    );
    if (createIndiciumData.ErrorCode !== 0) {
      let errorString = String(createIndiciumData);
      errorString = errorString.toLowerCase();
      let message = "";
      if (errorString.includes("insufficient")) {
        message =
          "Insufficient funds on account. Please check the account or change it and try again.";
      } else if (
        errorString.includes("due to the current status of your account")
      ) {
        message = "Failed: Account billing inactivity, cannot be used.";
      } else if (errorString.includes("only")) {
        message = "This account can not be used for usual Ground or Priority.";
      } else if (errorString.includes("expired")) {
        message =
          "Cookie expired. Please check the account or change it and try again.";
      } else if (errorString.includes("limit")) {
        message = "This account has reached monthly print limit.";
      } else {
        message = `Failed to create two up label: ${createIndiciumData.ErrorDescription}`;
      }

      logg(message, { level: "error" });
      throw new AccountError(message, "LABEL_CREATION_FAILED");
    }
  }

  writeFileSync("indicum-response-sample.json", createIndiciumData);

  // Step 2: Create Two Up Label
  const createTwoUpLabelResponse = await axiosInstance.post(
    "https://print.stamps.com/WebPostage/Ajax/CreateTwoUpLabel.aspx",
    JSON.stringify({
      isCreateTwoUpForPdf: true,
      layoutLeft: "domestic_pdf",
      layoutRight: "roll4x6",
      labelUrl: createIndiciumData.URL,
    })
  );

  const createTwoUpLabelData = createTwoUpLabelResponse.data;

  writeFileSync("two-up-label-response.json", createTwoUpLabelData);

  // Step 3: Get the PDF
  const getPdfResponse = await axiosInstance.get(
    `${createTwoUpLabelData.URL}&printType=pdf&scale=100:98&labelMargins=0:0:0:0`,
    { responseType: "arraybuffer" }
  );

  const pdfBuffer = Buffer.from(getPdfResponse.data);
  const filename = `${
    payload.Rate.ServiceType === "USGA" ? "Ground" : "Priority"
  }-${createIndiciumData.trackingNumber}.pdf`;

  return [pdfBuffer, filename];
}

function padThreeDigitsLabelName(number: number) {
  return number.toString().padStart(3, "0");
}

async function fetchAccountInfo(headers: BrowserSession["headers"]) {
  const axiosInstance = constructAxiosInstance(headers);

  const accInfoResponse = await axiosInstance.post(
    "https://print.stamps.com/WebPostage/Ajax/GetAccountInfo.aspx"
  );

  if (accInfoResponse.data["ErrorCode"] !== 0) {
    return null;
  }
  const accountInfo: StampsCustomerInfo = accInfoResponse.data;

  return accountInfo;
}

export async function addBalanceToAccount(session: BrowserSession) {
  try {
    const axiosInstance = constructAxiosInstance(session.headers);
    const controlTotal = session.controlTotal;
    // Random number between 10 and 500
    const amount = Math.floor(Math.random() * (500 - 10 + 1)) + 10;

    const fundAccResponse = await axiosInstance.post(
      "https://print.stamps.com/WebPostage/Ajax/PurchasePostage.aspx",
      JSON.stringify({
        PurchaseAmount: amount,
        ControlTotal: controlTotal,
        ClientFingerprint: "",
      })
    );
    // {"PurchaseStatus":"Success","TransactionID":235243140,"PostageBalance":{"AvailablePostage":207.1700,"ControlTotal":888.5300},"MIRequired":false,"ErrorCode":0,"ErrorDescription":""}
    const funded = fundAccResponse.data["PurchaseStatus"] === "Success";

    if (!funded) {
      const errorMsg = fundAccResponse.data["ErrorDescription"];
      throw new FundingError(errorMsg || "Unable to fund account");
    }
  } catch (error) {
    throw new FundingError(error);
  }
}

// fetch(
//   "https://print.endicia.com/WebPostage/Ajax/CreateIndicium.aspx?env=WebPostage",
//   {
//     headers: {
//       accept: "*/*",
//       "accept-language": "en-GB,en;q=0.9",
//       "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
//       "sec-ch-ua":
//         '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
//       "sec-ch-ua-mobile": "?0",
//       "sec-ch-ua-platform": '"Linux"',
//       "sec-fetch-dest": "empty",
//       "sec-fetch-mode": "cors",
//       "sec-fetch-site": "same-origin",
//       "x-requested-with": "XMLHttpRequest",
//       cookie:
//         "visid_incap_1859989=9ZsPMO1xT4qbys78QsiKimfLimYAAAAAQUIPAAAAAADeeH1RiGUBMQRG+tVHsm7H; nlbi_1859989=fJK7F5m6MEjXnSeltI3vJgAAAADf0f0tHNvHlOLQ5MDVIr+z; incap_ses_1182_1859989=6pKhcvCKSyJxrfsX1E5nEGfLimYAAAAA1f0PynUjshoEIxP6yWVeRQ==; incap_ses_87_1859989=JAbOZk9KZ3RS1pxyIRY1AWfLimYAAAAAVIvxC2/9Un6LkH8DtuFsSA==; incap_ses_214_1859989=MticHdQZphjLX2u98kf4AmjLimYAAAAA6DXnRb9pzCDaSG75rQXRGQ==; incap_ses_1433_1859989=RHgHJdzuRRci6Mej/wnjE2nLimYAAAAATq8A7zjmxYzfJygzeVlOIA==; incap_ses_118_1859989=13tvE8w5w3Ey67KSeTijAWrLimYAAAAABtKYDbre+QXiiZz0Lx6b9A==; incap_ses_195_1859989=MY3nU5TVznla0eiDjMe0AmrLimYAAAAA/ZM4le3E3z7PMTpdXPuC1Q==; incap_ses_208_1859989=4Dwych236zc2UvYoBPfiAmvLimYAAAAADCkAQzCj1KBhJEgz4uXtWA==; Visitor=172037207852613; incap_ses_1434_1859989=ZFILO5Au/BFA3gEBfJfmE2/LimYAAAAAS0VkEnHIYFodcrDt+dagTQ==; incap_ses_69_1859989=mS0BNSK+iGu9df5+NyP1AG7LimYAAAAAWfhTh0O1bDWP67+rS7Th4Q==; incap_ses_1437_1859989=A1A9bmzvGR/efD7r9z/xE27LimYAAAAAjsnGxFmt65U/UOENlitlsQ==; incap_ses_1436_1859989=bAmPAdIf2xjY7q1IebLtE2/LimYAAAAAwBzfx32zR/ZwSgzPfGVrZg==; incap_ses_209_1859989=LZq9RZEPDCYVub8kfoTmAnDLimYAAAAADsWPiNdHcWVHOvfKQJKm0A==; print_username=; shipstation-login-status=; existingcust=true; incap_ses_202_1859989=8hB7daBY0gmgKIoAA6bNAuHLimYAAAAA/rJwPw64v/YAUyIMahuuKw==; incap_ses_166_1859989=eg1nYOd1RE3qFHzmQcBNAuHLimYAAAAA5xSJx5dXlDDyKakFPDkFHQ==; incap_ses_8075_1859989=Pc88OFdbghPcg+/JzikQcOPLimYAAAAA/Irkdw9l76sQIOi6DOfv5w==; incap_ses_68_1859989=CIzxDWJsoWTFsBnguJXxAOPLimYAAAAAIoxWg0UuoLv9xVIVI9Cp3g==; incap_ses_215_1859989=hsK7OhkEthO6uaxhcdX7AuTLimYAAAAAtlIGlUWqE0G9vuOeqRR4cw==; optimizelyEndUserId=oeu1720372198539r0.3276271309337908; incap_ses_211_1859989=yKXXB2U0YCllvW/Pdp/tAubLimYAAAAAqAu2URWZNROsdWabmmyDSQ==; incap_ses_205_1859989=gtzHctYwpAyZXqzyfk7YAu7LimYAAAAAPt7+Ddss/kGtbevZC5VpWw==; incap_ses_617_1859989=DCO0QAAr2DuVadtrYAaQCO/LimYAAAAAb90h1dhOlzrNy1i8YHVFeQ==; incap_ses_1178_1859989=yvFWYbXrWS0AZx+C2RhZEO/LimYAAAAAMN2F9fMXaidCvCasZCLaZA==; incap_ses_516_1859989=yVwHLuQ6hAP3Ir7EXTMpB/DLimYAAAAAQg47DnHox0MU89AqXCuDOg==; ajs_user_id=11080520; ajs_anonymous_id=3cc81628-3f0d-4862-bcdc-922cd8fc4011; ajs_group_id=8139007; incap_ses_979_1859989=HJRrOH2oRxxq+yxyYBuWDfHLimYAAAAA1m4Sjq7TxQ7PnxhnlRdKLQ==; incap_ses_1363_1859989=dQP1drTYmH5wF6yVXlnqEvXLimYAAAAAzHMHsK/Y5602wLP4F5x2+Q==; incap_ses_619_1859989=bqWdWaJ3NkIhIkO3TyGXCOHMimYAAAAALJudSEdAT9ghGCRdlp1bBw==; incap_ses_210_1859989=yRnMMpCRJDA3R0Z++hHqApTNimYAAAAAs9wjPDg8dVdcS5k+1ian5Q==; incap_ses_1435_1859989=LL3hXX3Ax0Zpyn2k+iTqE2PTimYAAAAAG4queDQqqVofPBZtTrN+yA==; user-info=uid=11080520&expire=2024-07-07T18:15:20&s=8bfbae3bedbd41c7aa76afca822d1221&custid=8139007&mac=0UjhroiYJwVMAFxDMCxHeII8114=",
//       Referer: "https://print.endicia.com/",
//       "Referrer-Policy": "strict-origin",
//     },
//     body: '{"costCodeID":0,"CustomerID":8139007,"Customs":"","deliveryNotification":false,"EltronPrinterDPType":"Default","integratorTxId":"00000000-0000-0000-0000-000000000000","keepUrlSplit":true,"labelColumn":1,"labelRow":1,"Reference1":"","memo":"","printMemo":false,"NonDeliveryOption":"Return","OrderID":"","printerName":null,"printerOrientation":"portrait","printerTray":null,"printInstructions":false,"PrintLayout":"Normal4X6","recipientEmail":"","rotationDegrees":0,"SampleOnly":false,"TrackingNumber":"","verticalOffset":0,"ImageType":"EncryptedPngUrl","ReturnTo":{"FullName":"Brenda McLean","Company":"","Address1":"2400 Riverstone Blvd Unit 5814","Address2":"","Address3":"","City":"Canton","State":"GA","ZIPCode":"30114","ZIPCodeAddOn":"0316","PhoneNumber":"6789419322","CleanseHash":"bPKZJiUGCFM3+4QftiFZPBgZIblkZWFkYmVlZg==20210613C770","OverrideHash":"eYMUG3AuzlY1f6DwBHH6f0Bmf7ZkZWFkYmVlZg==20210613C770"},"Rate":{"From":{"FullName":"Brenda McLean","Company":"","Address1":"2400 Riverstone Blvd Unit 5814","Address2":"","Address3":"","City":"Canton","State":"GA","ZIPCode":"30114","ZIPCodeAddOn":"0316","PhoneNumber":"6789419322","CleanseHash":"bPKZJiUGCFM3+4QftiFZPBgZIblkZWFkYmVlZg==20210613C770","OverrideHash":"eYMUG3AuzlY1f6DwBHH6f0Bmf7ZkZWFkYmVlZg==20210613C770"},"To":{"FullName":"Qun S   ","Company":"","PhoneNumber":"","Address1":"Carle Rd","Address2":"","Address3":"","City":"Akron","Country":"US","freeFormAddress":"Qun S   \\nCarle Rd\\nAkron, OH 44333","CleanseMessage":"Override","CleanseHash":"","OverrideHash":"","EmailAddress":"","State":"OH","ZIPCode":"44333","ZIPCodeAddOn":""},"Amount":4.38,"ServiceType":"USGA","DeliverDays":null,"Error":null,"WeightLb":0,"WeightOz":5,"PackageType":"LargePackage","ShipDate":"2024-07-10","ShipDateSpecified":true,"InsuredValue":0,"RegisteredValue":0,"CODValue":0,"DeclaredValue":1,"RectangularShaped":true,"Prohibitions":null,"Restrictions":null,"Observations":null,"Regulations":null,"GEMNotes":null,"MaxDimensions":null,"DimWeighting":null,"AddOns":[{"AddOnType":"SCAHP","Amount":0},{"AddOnType":"USADC","Amount":0}],"EffectiveWeightInOunces":0,"IsIntraBMC":false,"Zone":0,"RateCategory":0,"NonMachinable":false,"Length":8,"Width":8,"Height":1,"PrintLayout":"Normal4X6"},"printerPaperHeight":6,"printerPaperWidth":4}',
//     method: "POST",
//   }
// );

// Response
// {
//   StampsTxID: "cf7e0160-901d-427f-8da0-b6b2e87bb2cf",
//   URL: "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",
//   mac: "njxfEsq5Z+3+kcdfGLxdQuhBt3yytAxk3Bu3Xla+m6g1gJQd1qhoD3UdOsDFeysBQbMzlXBRMCf7mpmIsTfdLA==",
//   PostageBalance: { AvailablePostage: 56.81, ControlTotal: 268.5 },
//   printCommand:
//     "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",
//   printCommandX: "bD+NdVzLHvaOTCAtMkdYbw2bAOA=",
//   trackingNumber: "9400111206204294788574",
//   formUrl: "",
//   isGPAPI: false,
//   ErrorCode: 0,
//   ErrorDescription: "",
// };

// fetch("https://print.endicia.com/WebPostage/Ajax/CreateTwoUpLabel.aspx", {
//   headers: {
//     accept: "*/*",
//     "accept-language": "en-GB,en;q=0.9",
//     "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
//     "sec-ch-ua":
//       '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
//     "sec-ch-ua-mobile": "?0",
//     "sec-ch-ua-platform": '"Linux"',
//     "sec-fetch-dest": "empty",
//     "sec-fetch-mode": "cors",
//     "sec-fetch-site": "same-origin",
//     "x-requested-with": "XMLHttpRequest",
//     cookie:
//       "visid_incap_1859989=9ZsPMO1xT4qbys78QsiKimfLimYAAAAAQUIPAAAAAADeeH1RiGUBMQRG+tVHsm7H; nlbi_1859989=fJK7F5m6MEjXnSeltI3vJgAAAADf0f0tHNvHlOLQ5MDVIr+z; incap_ses_1182_1859989=6pKhcvCKSyJxrfsX1E5nEGfLimYAAAAA1f0PynUjshoEIxP6yWVeRQ==; incap_ses_87_1859989=JAbOZk9KZ3RS1pxyIRY1AWfLimYAAAAAVIvxC2/9Un6LkH8DtuFsSA==; incap_ses_214_1859989=MticHdQZphjLX2u98kf4AmjLimYAAAAA6DXnRb9pzCDaSG75rQXRGQ==; incap_ses_1433_1859989=RHgHJdzuRRci6Mej/wnjE2nLimYAAAAATq8A7zjmxYzfJygzeVlOIA==; incap_ses_118_1859989=13tvE8w5w3Ey67KSeTijAWrLimYAAAAABtKYDbre+QXiiZz0Lx6b9A==; incap_ses_195_1859989=MY3nU5TVznla0eiDjMe0AmrLimYAAAAA/ZM4le3E3z7PMTpdXPuC1Q==; incap_ses_208_1859989=4Dwych236zc2UvYoBPfiAmvLimYAAAAADCkAQzCj1KBhJEgz4uXtWA==; Visitor=172037207852613; incap_ses_1434_1859989=ZFILO5Au/BFA3gEBfJfmE2/LimYAAAAAS0VkEnHIYFodcrDt+dagTQ==; incap_ses_69_1859989=mS0BNSK+iGu9df5+NyP1AG7LimYAAAAAWfhTh0O1bDWP67+rS7Th4Q==; incap_ses_1437_1859989=A1A9bmzvGR/efD7r9z/xE27LimYAAAAAjsnGxFmt65U/UOENlitlsQ==; incap_ses_1436_1859989=bAmPAdIf2xjY7q1IebLtE2/LimYAAAAAwBzfx32zR/ZwSgzPfGVrZg==; incap_ses_209_1859989=LZq9RZEPDCYVub8kfoTmAnDLimYAAAAADsWPiNdHcWVHOvfKQJKm0A==; print_username=; shipstation-login-status=; existingcust=true; incap_ses_202_1859989=8hB7daBY0gmgKIoAA6bNAuHLimYAAAAA/rJwPw64v/YAUyIMahuuKw==; incap_ses_166_1859989=eg1nYOd1RE3qFHzmQcBNAuHLimYAAAAA5xSJx5dXlDDyKakFPDkFHQ==; incap_ses_8075_1859989=Pc88OFdbghPcg+/JzikQcOPLimYAAAAA/Irkdw9l76sQIOi6DOfv5w==; incap_ses_68_1859989=CIzxDWJsoWTFsBnguJXxAOPLimYAAAAAIoxWg0UuoLv9xVIVI9Cp3g==; incap_ses_215_1859989=hsK7OhkEthO6uaxhcdX7AuTLimYAAAAAtlIGlUWqE0G9vuOeqRR4cw==; optimizelyEndUserId=oeu1720372198539r0.3276271309337908; incap_ses_211_1859989=yKXXB2U0YCllvW/Pdp/tAubLimYAAAAAqAu2URWZNROsdWabmmyDSQ==; incap_ses_205_1859989=gtzHctYwpAyZXqzyfk7YAu7LimYAAAAAPt7+Ddss/kGtbevZC5VpWw==; incap_ses_617_1859989=DCO0QAAr2DuVadtrYAaQCO/LimYAAAAAb90h1dhOlzrNy1i8YHVFeQ==; incap_ses_1178_1859989=yvFWYbXrWS0AZx+C2RhZEO/LimYAAAAAMN2F9fMXaidCvCasZCLaZA==; incap_ses_516_1859989=yVwHLuQ6hAP3Ir7EXTMpB/DLimYAAAAAQg47DnHox0MU89AqXCuDOg==; ajs_user_id=11080520; ajs_anonymous_id=3cc81628-3f0d-4862-bcdc-922cd8fc4011; ajs_group_id=8139007; incap_ses_979_1859989=HJRrOH2oRxxq+yxyYBuWDfHLimYAAAAA1m4Sjq7TxQ7PnxhnlRdKLQ==; incap_ses_1363_1859989=dQP1drTYmH5wF6yVXlnqEvXLimYAAAAAzHMHsK/Y5602wLP4F5x2+Q==; incap_ses_619_1859989=bqWdWaJ3NkIhIkO3TyGXCOHMimYAAAAALJudSEdAT9ghGCRdlp1bBw==; incap_ses_210_1859989=yRnMMpCRJDA3R0Z++hHqApTNimYAAAAAs9wjPDg8dVdcS5k+1ian5Q==; incap_ses_1435_1859989=LL3hXX3Ax0Zpyn2k+iTqE2PTimYAAAAAG4queDQqqVofPBZtTrN+yA==; user-info=uid=11080520&expire=2024-07-07T18:16:08&s=8bfbae3bedbd41c7aa76afca822d1221&custid=8139007&mac=hSI9rPUPQFD4BDMBtHw4J7SdMzg=",
//     Referer: "https://print.endicia.com/",
//     "Referrer-Policy": "strict-origin",
//   },
//   body: '{"isCreateTwoUpForPdf":true,"layoutLeft":"domestic_pdf","layoutRight":"roll4x6","labelUrl":"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"}',
//   method: "POST",
// });

// Response
// {
//   "ErrorCode": 0,
//   "ErrorDescription": "",
//   "URL": "https://print.endicia.com/webpostage/GetTwoUpLabelImage.aspx?labelid=68cfdf1b-0f1f-4d7e-885a-11a458f1ce21&fullPage=&layout=domestic_pdf"
// }

// fetch(
//   "https://print.endicia.com/webpostage/GetTwoUpLabelImage.aspx?labelid=68cfdf1b-0f1f-4d7e-885a-11a458f1ce21&fullPage=&layout=domestic_pdf&printType=pdf&scale=100:98&labelMargins=0:0:0:0",
//   {
//     headers: {
//       accept: "*/*",
//       "accept-language": "en-GB,en;q=0.9",
//       "sec-ch-ua":
//         '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
//       "sec-ch-ua-mobile": "?0",
//       "sec-ch-ua-platform": '"Linux"',
//       "sec-fetch-dest": "empty",
//       "sec-fetch-mode": "cors",
//       "sec-fetch-site": "same-origin",
//       cookie:
//         "visid_incap_1859989=9ZsPMO1xT4qbys78QsiKimfLimYAAAAAQUIPAAAAAADeeH1RiGUBMQRG+tVHsm7H; nlbi_1859989=fJK7F5m6MEjXnSeltI3vJgAAAADf0f0tHNvHlOLQ5MDVIr+z; incap_ses_1182_1859989=6pKhcvCKSyJxrfsX1E5nEGfLimYAAAAA1f0PynUjshoEIxP6yWVeRQ==; incap_ses_87_1859989=JAbOZk9KZ3RS1pxyIRY1AWfLimYAAAAAVIvxC2/9Un6LkH8DtuFsSA==; incap_ses_214_1859989=MticHdQZphjLX2u98kf4AmjLimYAAAAA6DXnRb9pzCDaSG75rQXRGQ==; incap_ses_1433_1859989=RHgHJdzuRRci6Mej/wnjE2nLimYAAAAATq8A7zjmxYzfJygzeVlOIA==; incap_ses_118_1859989=13tvE8w5w3Ey67KSeTijAWrLimYAAAAABtKYDbre+QXiiZz0Lx6b9A==; incap_ses_195_1859989=MY3nU5TVznla0eiDjMe0AmrLimYAAAAA/ZM4le3E3z7PMTpdXPuC1Q==; incap_ses_208_1859989=4Dwych236zc2UvYoBPfiAmvLimYAAAAADCkAQzCj1KBhJEgz4uXtWA==; Visitor=172037207852613; incap_ses_1434_1859989=ZFILO5Au/BFA3gEBfJfmE2/LimYAAAAAS0VkEnHIYFodcrDt+dagTQ==; incap_ses_69_1859989=mS0BNSK+iGu9df5+NyP1AG7LimYAAAAAWfhTh0O1bDWP67+rS7Th4Q==; incap_ses_1437_1859989=A1A9bmzvGR/efD7r9z/xE27LimYAAAAAjsnGxFmt65U/UOENlitlsQ==; incap_ses_1436_1859989=bAmPAdIf2xjY7q1IebLtE2/LimYAAAAAwBzfx32zR/ZwSgzPfGVrZg==; incap_ses_209_1859989=LZq9RZEPDCYVub8kfoTmAnDLimYAAAAADsWPiNdHcWVHOvfKQJKm0A==; print_username=; shipstation-login-status=; existingcust=true; incap_ses_202_1859989=8hB7daBY0gmgKIoAA6bNAuHLimYAAAAA/rJwPw64v/YAUyIMahuuKw==; incap_ses_166_1859989=eg1nYOd1RE3qFHzmQcBNAuHLimYAAAAA5xSJx5dXlDDyKakFPDkFHQ==; incap_ses_8075_1859989=Pc88OFdbghPcg+/JzikQcOPLimYAAAAA/Irkdw9l76sQIOi6DOfv5w==; incap_ses_68_1859989=CIzxDWJsoWTFsBnguJXxAOPLimYAAAAAIoxWg0UuoLv9xVIVI9Cp3g==; incap_ses_215_1859989=hsK7OhkEthO6uaxhcdX7AuTLimYAAAAAtlIGlUWqE0G9vuOeqRR4cw==; optimizelyEndUserId=oeu1720372198539r0.3276271309337908; incap_ses_211_1859989=yKXXB2U0YCllvW/Pdp/tAubLimYAAAAAqAu2URWZNROsdWabmmyDSQ==; incap_ses_205_1859989=gtzHctYwpAyZXqzyfk7YAu7LimYAAAAAPt7+Ddss/kGtbevZC5VpWw==; incap_ses_617_1859989=DCO0QAAr2DuVadtrYAaQCO/LimYAAAAAb90h1dhOlzrNy1i8YHVFeQ==; incap_ses_1178_1859989=yvFWYbXrWS0AZx+C2RhZEO/LimYAAAAAMN2F9fMXaidCvCasZCLaZA==; incap_ses_516_1859989=yVwHLuQ6hAP3Ir7EXTMpB/DLimYAAAAAQg47DnHox0MU89AqXCuDOg==; ajs_user_id=11080520; ajs_anonymous_id=3cc81628-3f0d-4862-bcdc-922cd8fc4011; ajs_group_id=8139007; incap_ses_979_1859989=HJRrOH2oRxxq+yxyYBuWDfHLimYAAAAA1m4Sjq7TxQ7PnxhnlRdKLQ==; incap_ses_1363_1859989=dQP1drTYmH5wF6yVXlnqEvXLimYAAAAAzHMHsK/Y5602wLP4F5x2+Q==; incap_ses_619_1859989=bqWdWaJ3NkIhIkO3TyGXCOHMimYAAAAALJudSEdAT9ghGCRdlp1bBw==; incap_ses_210_1859989=yRnMMpCRJDA3R0Z++hHqApTNimYAAAAAs9wjPDg8dVdcS5k+1ian5Q==; incap_ses_1435_1859989=LL3hXX3Ax0Zpyn2k+iTqE2PTimYAAAAAG4queDQqqVofPBZtTrN+yA==; user-info=uid=11080520&expire=2024-07-07T18:16:14&s=8bfbae3bedbd41c7aa76afca822d1221&custid=8139007&mac=MmuHknXHQS7xZQVJVSYJDgc2FNY=",
//       Referer: "https://print.endicia.com/",
//       "Referrer-Policy": "strict-origin",
//     },
//     body: null,
//     method: "GET",
//   }
// );

// Response
// pdf
// HTTP/1.1 200 OK
// Cache-Control: private
// Content-Type: application/pdf
// Content-Disposition: inline
// X-Content-Type-Options: nosniff
// Content-Security-Policy: upgrade-insecure-requests
// Referrer-Policy: strict-origin
// Permissions-Policy: geolocation=(), midi=(), sync-xhr=(), microphone=(), camera=(), magnetometer=(), gyroscope=(), fullscreen=(self), payment=()
// X-Xss-Protection: 1; mode=block
// Date: Sun, 07 Jul 2024 17:46:16 GMT
// Connection: close
// Content-Length: 4314
// X-CDN: Imperva
// X-Iinfo: 9-49964010-49964030 NNNN CT(61 49 0) RT(1720374375791 520) q(0 0 1 -1) r(2 2) U24
