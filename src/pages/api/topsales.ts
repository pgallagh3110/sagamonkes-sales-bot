import { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "../../../utils/mongoConnect";

const dbCollection = 'sales';

export const maxDuration = 60; // 60 seconds
export const dynamic = 'force-dynamic';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await getClient();
    const db = client.db();
    const collection = db.collection(dbCollection);

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const topSales = await collection.find({
      createdAt: { $gte: twentyFourHoursAgo } ,
      collection: {$eq: process.env.COLLECTION}
   
    }).sort({ price: -1 }).limit(12).toArray();

    if (topSales.length === 0) {
      return res.status(200).json({ message: 'No sales in the past 24 hours' });
    }
    
    const embedFields = topSales.map((sale, index) => ({

      name: `${index + 1}`,
      value: `[Saga Monke #${sale.image.match(/(\d+)\.png$/)?.[1]}](https://solana.fm/address/${sale.tokenMint})\nPrice: ${sale.price.toFixed(2)} ◎`,
      inline: true
    }));

    const topSale = topSales[0];

    const embed = {
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

    await sendToDiscord(embed);

    res.status(200).json({ message: 'Success' });
  } catch (error) {
    console.error('Error fetching top sales or sending to Discord:', error);
    res.status(500).json({ error: 'Internal Server Error' });
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
