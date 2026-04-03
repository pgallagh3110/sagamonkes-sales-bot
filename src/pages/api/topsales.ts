import { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "../../../utils/mongoConnect";

const dbCollection = 'sales';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await getClient();
    const db = client.db();
    const collection = db.collection(dbCollection);

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const collectionFilter = {
      createdAt: { $gte: twentyFourHoursAgo },
      collection: { $eq: process.env.COLLECTION }
    };

    // Get all sales for volume/count, top 12 for the embed
    const [allSales, topSales] = await Promise.all([
      collection.find(collectionFilter).toArray(),
      collection.find(collectionFilter).sort({ price: -1 }).limit(12).toArray(),
    ]);

    if (topSales.length === 0) {
      console.log('No sales in the past 24 hours');
      return res.status(200).json({ message: 'No sales in the past 24 hours' });
    }

    const totalVolume = allSales.reduce((sum, s) => sum + s.price, 0);
    const totalCount = allSales.length;
    const topSale = topSales[0];

    const embedFields = topSales.map((sale, index) => ({
      name: `${index + 1}`,
      value: `[Saga Monke #${sale.image.match(/(\d+)\.png$/)?.[1]}](https://solana.fm/address/${sale.tokenMint})\nPrice: ${sale.price.toFixed(2)} ◎`,
      inline: true
    }));

    // Add summary field
    embedFields.unshift({
      name: '📊 24h Summary',
      value: `**${totalCount}** sales · **${totalVolume.toFixed(2)} ◎** volume`,
      inline: false
    });

    const discordEmbed = {
      content: null,
      embeds: [{
        title: 'Top Saga Monke 24hr Sales',
        color: 16486972,
        fields: embedFields,
        image: { url: topSale.image },
        timestamp: new Date().toISOString(),
        footer: {
          text: "MonkeSales: 24hr Sales",
          icon_url: "https://media.discordapp.net/attachments/1058514014092668958/1248039086930006108/logo.png?ex=66623679&is=6660e4f9&hm=f68083d86a2856a80cb4d04bdb71e2361f39bf5cf136dd293b24346a8b051827&=&format=webp&quality=lossless&width=487&height=487"
        }
      }],
    };

    const telegramCaption = buildTelegramCaption(topSales, totalCount, totalVolume);

    await Promise.all([
      sendToDiscord(discordEmbed),
      sendToTelegram(topSale.image, telegramCaption),
    ]);

    res.status(200).json({ message: 'Success' });
  } catch (error) {
    console.error('Error fetching top sales:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

function buildTelegramCaption(topSales: any[], totalCount: number, totalVolume: number): string {
  const lines = [
    `📊 <b>Top Saga Monke Sales — Last 24h</b>`,
    ``,
    `🏆 Sales: <b>${totalCount}</b>  |  Volume: <b>${totalVolume.toFixed(2)} ◎</b>`,
    ``,
  ];

  topSales.slice(0, 10).forEach((sale, i) => {
    const monkeNum = sale.image.match(/(\d+)\.png$/)?.[1] ?? '?';
    lines.push(`${i + 1}. <a href="https://solscan.io/token/${sale.tokenMint}">MONKE #${monkeNum}</a> — ${sale.price.toFixed(2)} ◎`);
  });

  return lines.join('\n');
}

async function sendToTelegram(imageUrl: string, caption: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_MONKES_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('TELEGRAM_BOT_TOKEN or TELEGRAM_MONKES_CHAT_ID not set');
    return;
  }

  const base = `https://api.telegram.org/bot${token}`;

  const res = await fetch(`${base}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption,
      parse_mode: 'HTML',
    }),
  });

  if (!res.ok) {
    // Fall back to text if photo fails
    await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'HTML' }),
    });
  }
}

async function sendToDiscord(embed: any) {
  const webhook = process.env.DISCORD_WEBHOOK;

  if (!webhook) {
    console.error("DISCORD_WEBHOOK is not defined");
    return;
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embed),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook response not OK: ${response.statusText}`);
  }

  console.log("Discord response status:", response.status);
}
