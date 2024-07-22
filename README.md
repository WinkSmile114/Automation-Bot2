## Label Generator

Project manifest:

Basically an automation system Telegram bot for shipping labels generation using Stamp.com API and OpenAI to convert human text data into Stamps label endpoint post data.

User shipping data text > OpenAI text to JSON > Post Stamps API > Get Label PDF > Telegram bot sends to user

Shipping labels API session login, mainly to get login cookies from Stamps.com for the account:

To set a shipping account of Stamps.com (Will be set by us)

Use NPM Puppeteer to login the account on https://print.stamps.com/SignIn/ and get login session.

And this gives us access to an endpoint to generate labels directly.

Telegram bot:
Start the Telegram bot, if label command is used, it should use OpenAI's API to convert text data into JSON using prompt.

To use the JSON and logged in session to generate a label and send the PDF file to user.

####

user enters
From
`Halley Jo Wiseman    6789912345  44321  63 GARNETT CIR    COPLEY  OH`
To
`/generate Elias Ortega    0000000000  33023-6342  3320 SW 36th Ct     HOLLYWOOD  FL  3oz  4  4  1  USPS Ground Advantage`

<!-- await client.send("Network.clearBrowserCookies");
  await client.send("Network.clearBrowserCache"); -->

# Updates

- [ ] Ability to add balance on the account.

- [x] A command to view stats of each day generation. Number of shipments, accounts used, balance used, number of shipment types.

- [x] More shipment data validation.

- [x] Warehouse recommendations to use a single command for the generation.

- [x] Using GPT-4o to help users understand what the error actually means.

- [x] Code refactoring and improvements you would feel like.
