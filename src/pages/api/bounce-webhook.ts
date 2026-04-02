import { NextApiRequest, NextApiResponse } from "next";

const rpc = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`;
const MPL_CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const CREATE_V2_DISCRIMINATOR = 0x14; // decimal 20 — confirmed from on-chain tx

const CACHE_DURATION = 20 * 1000;
const requestCache: { [key: string]: number } = {};

// Minimal base58 decode — returns first byte of decoded data
function base58FirstByte(s: string): number {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of s) {
    n = n * 58n + BigInt(ALPHABET.indexOf(c));
  }
  if (n === 0n) return 0;
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return bytes[0];
}

const getAsset = async (mint: string) => {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "bounce",
      method: "getAsset",
      params: { id: mint },
    }),
  });
  const { result } = await response.json();
  return result;
};

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

async function sendTelegram(imageUrl: string | null, caption: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    return;
  }

  const base = `https://api.telegram.org/bot${token}`;

  if (imageUrl) {
    const res = await fetch(`${base}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: imageUrl,
        caption,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      console.warn("sendPhoto failed, falling back to sendMessage");
      await sendTelegramText(base, chatId, caption);
    }
  } else {
    await sendTelegramText(base, chatId, caption);
  }
}

async function sendTelegramText(base: string, chatId: string, text: string) {
  await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function sendDiscord(
  webhook: string,
  name: string,
  mint: string,
  imageUrl: string,
  buyer: string,
  timestamp: number
) {
  const embed = {
    content: null,
    embeds: [
      {
        title: `${name} has been claimed!`,
        url: `https://solscan.io/token/${mint}`,
        color: 0x9b59b6,
        fields: [
          { name: "📅 Claim Date", value: `<t:${timestamp}:R>`, inline: true },
          { name: "Claimed by", value: shorten(buyer), inline: true },
        ],
        image: { url: imageUrl },
        timestamp: new Date().toISOString(),
        footer: { text: "BounceSales" },
      },
    ],
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(embed),
  });

  if (!res.ok) {
    throw new Error(`Discord webhook error: ${res.statusText}`);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const webhookData = req.body;
    if (!Array.isArray(webhookData) || webhookData.length === 0) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const rawTx = webhookData[0];

    // Raw webhook: signature is in transaction.signatures[0]
    const signature: string = rawTx.transaction?.signatures?.[0] ?? "";
    if (!signature) {
      console.error("No signature in payload:", JSON.stringify(rawTx).slice(0, 200));
      return res.status(400).json({ error: "No signature found" });
    }

    // Deduplicate
    if (
      requestCache[signature] &&
      Date.now() - requestCache[signature] < CACHE_DURATION
    ) {
      console.log("Duplicate ignored:", signature.slice(0, 16));
      return res.status(200).json({ message: "Duplicate ignored" });
    }
    requestCache[signature] = Date.now();

    // Skip failed transactions
    if (rawTx.meta?.err) {
      return res.status(200).json({ message: "Transaction failed, skipping" });
    }

    // Raw webhook format: accountKeys are pubkey strings, instruction accounts are indices
    const accountKeys: string[] = rawTx.transaction.message.accountKeys;
    const instructions: any[] = rawTx.transaction.message.instructions;

    // Find the MPL Core createV2 instruction
    const mplCoreIx = instructions.find((ix) => {
      if (accountKeys[ix.programIdIndex] !== MPL_CORE_PROGRAM) return false;
      try {
        return base58FirstByte(ix.data) === CREATE_V2_DISCRIMINATOR;
      } catch {
        return false;
      }
    });

    if (!mplCoreIx) {
      console.log("No MPL Core createV2 found in tx:", signature.slice(0, 16));
      return res.status(200).json({ message: "Not a Bounce mint" });
    }

    // Asset = accounts[0] of the MPL Core instruction (index into accountKeys)
    const assetAddress: string = accountKeys[mplCoreIx.accounts[0]];
    // Buyer = fee payer = always accountKeys[0] in any Solana transaction
    const buyer: string = accountKeys[0];
    const timestamp: number = rawTx.blockTime ?? 0;

    const asset = await getAsset(assetAddress);
    const name: string = asset?.content?.metadata?.name ?? "Bounce NFT";
    const imageUrl: string =
      asset?.content?.links?.image ??
      asset?.content?.files?.[0]?.cdn_uri ??
      asset?.content?.files?.[0]?.uri ??
      "";

    console.log(
      `Bounce mint: ${name} | asset: ${assetAddress} | buyer: ${shorten(buyer)}`
    );

    const formattedDate = new Date(timestamp * 1000).toLocaleDateString("en-US");

    const caption = [
      `<b>${name} has been claimed!</b>`,
      ``,
      `📅 Claim Date`,
      `${formattedDate}`,
      ``,
      `Claimed by`,
      `${buyer}`,
      ``,
      `🔗 <a href="https://solscan.io/token/${assetAddress}">View on Solscan</a>`,
    ].join("\n");

    await sendTelegram(imageUrl || null, caption);

    const discordWebhook = process.env.BOUNCE_DISCORD_WEBHOOK;
    if (discordWebhook && imageUrl) {
      await sendDiscord(discordWebhook, name, assetAddress, imageUrl, buyer, timestamp);
    }

    return res.status(200).json({ message: "Success" });
  } catch (err) {
    console.error("Error processing Bounce webhook:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
