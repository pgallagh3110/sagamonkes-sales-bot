import { NextApiRequest, NextApiResponse } from "next";

const rpc = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`;

const CACHE_DURATION = 20 * 1000;
const requestCache: { [key: string]: number } = {};

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

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(3);
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
      // Image URL may be broken — fall back to text
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
  priceSol: string,
  buyer: string,
  seller: string,
  source: string,
  timestamp: number
) {
  const embed = {
    content: null,
    embeds: [
      {
        title: `${name} has sold!`,
        url: `https://solscan.io/token/${mint}`,
        color: 0x9b59b6,
        fields: [
          { name: "💰 Sale Price", value: `**${priceSol} SOL**`, inline: true },
          {
            name: "📅 Sale Date",
            value: `<t:${timestamp}:R>`,
            inline: true,
          },
          { name: "Buyer", value: shorten(buyer), inline: true },
          { name: "Seller", value: shorten(seller), inline: true },
          { name: "Marketplace", value: source, inline: true },
        ],
        image: { url: imageUrl },
        timestamp: new Date().toISOString(),
        footer: {
          text: "BounceSales",
        },
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

    const firstSignature = webhookData?.[0]?.signature;
    if (!firstSignature) {
      console.error("No signature in payload:", webhookData);
      return res.status(400).json({ error: "No signature found" });
    }

    // Deduplicate
    if (
      requestCache[firstSignature] &&
      Date.now() - requestCache[firstSignature] < CACHE_DURATION
    ) {
      console.log("Duplicate request ignored:", firstSignature);
      return res.status(200).json({ message: "Duplicate ignored" });
    }
    requestCache[firstSignature] = Date.now();

    const tx = webhookData[0];

    if (tx.type !== "TRANSFER") {
      console.log(`Skipping non-transfer event: ${tx.type}`);
      return res.status(200).json({ message: "Not a transfer" });
    }

    // Find the NFT token transfer
    const nftTransfer = (tx.tokenTransfers ?? []).find(
      (t: any) => t.tokenAmount === 1
    );
    if (!nftTransfer) {
      console.log("No NFT token transfer found, skipping");
      return res.status(200).json({ message: "No NFT transfer" });
    }

    const mint: string = nftTransfer.mint;
    const buyer: string = nftTransfer.toUserAccount ?? tx.feePayer ?? "";
    const timestamp: number = tx.timestamp ?? 0;

    // Price = buyer's total SOL spent (nativeBalanceChange is negative for buyer)
    const buyerAccountData = (tx.accountData ?? []).find(
      (a: any) => a.account === (tx.feePayer ?? buyer)
    );
    const amount: number = buyerAccountData
      ? Math.abs(buyerAccountData.nativeBalanceChange)
      : 0;
    const priceSol = formatSol(amount);

    const asset = await getAsset(mint);
    const name: string = asset?.content?.metadata?.name ?? "Bounce NFT";
    const imageUrl: string =
      asset?.content?.links?.image ??
      asset?.content?.files?.[0]?.cdn_uri ??
      asset?.content?.files?.[0]?.uri ??
      "";

    console.log(`Bounce transfer: ${name} | ${priceSol} SOL | minted to ${buyer}`);

    const formattedDate = new Date(timestamp * 1000).toLocaleDateString("en-US");

    const caption = [
      `<b>${name} has been claimed!</b>`,
      ``,
      `💰 Sale Price`,
      `${priceSol} ◎`,
      ``,
      `📅 Claim Date`,
      `${formattedDate}`,
      ``,
      `Claimed by`,
      `${buyer}`,
      ``,
      `🔗 <a href="https://solscan.io/token/${mint}">View on Solscan</a>`,
    ].join("\n");

    await sendTelegram(imageUrl || null, caption);

    // Also post to Discord if webhook is configured
    const discordWebhook = process.env.BOUNCE_DISCORD_WEBHOOK;
    if (discordWebhook && imageUrl) {
      await sendDiscord(
        discordWebhook,
        name,
        mint,
        imageUrl,
        priceSol,
        buyer,
        "",
        "ORB",
        timestamp
      );
    }

    return res.status(200).json({ message: "Success" });
  } catch (err) {
    console.error("Error processing Bounce webhook:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
