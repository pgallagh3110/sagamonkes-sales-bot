import { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "../../../utils/mongoConnect";

export const maxDuration = 60; // 60 seconds
export const dynamic = 'force-dynamic';

const collectionName = process .env.COLLECTION;
const dbCollection = 'sales'

const MAGICEDEN_API_URL = `https://api-mainnet.magiceden.dev/v2/collections/${collectionName}/activities?offset=0&limit=100`;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await getClient();
    const db = client.db();
    const collection = db.collection(dbCollection);

    let activities;

    if (req.query.test === 'true') {
      activities = req.body;
      console.log('Test Activities:', activities);
    } else {
      const response = await fetch(MAGICEDEN_API_URL);
      activities = await response.json();
      console.log('Fetched Activities:', activities);
    }

    if (!Array.isArray(activities)) {
      console.error('Activities is not an array:', activities);
      return res.status(400).json({ error: 'Invalid data format' });
    }

    for (const activity of activities) {
      if (activity.type === 'buyNow') {
        const existingActivity = await collection.findOne({ signature: activity.signature });

        if (!existingActivity) {
          const newActivity = {
            signature: activity.signature,
            tokenMint: activity.tokenMint,
            collection: activity.collection,
            blockTime: activity.blockTime,
            buyer: activity.buyer,
            seller: activity.seller,
            price: activity.price,
            image: activity.image,
            createdAt: new Date()
          };

          await collection.insertOne(newActivity);

          await sendToDiscord(activity);

          await delay(500); // 0.5 second delay
        }
      }
    }

    res.status(200).json({ message: 'Success' });
  } catch (error) {
    console.error('Error fetching activities or sending to Discord:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function sendToDiscord(activity: any) {
  const webhook = process.env.DISCORD_WEBHOOK;

  if (!webhook) {
    console.error("DISCORD_WEBHOOK is not defined");
    return;
  }

  const { tokenMint, price, buyer, seller, image, blockTime, source} = activity;

  const formattedDate = new Date(blockTime * 1000).toLocaleDateString("en-US");
  const monkeNumber = image.match(/(\d+)\.png$/)?.[1];

  let marketplace;
  if (source.toLowerCase().includes('magic')) {
    marketplace = 'Magic Eden';
  } else if (source.toLowerCase().includes('tensor')) {
    marketplace = 'Tensor';
  } else {
    marketplace = 'Other';
  }

  const embed = {
    content: null,
    embeds: [{
      title: `Saga Monke #${monkeNumber} has sold!`,
      url: `https://solscan.io/token/${tokenMint}`,
      color: 16486972,
      fields: [
        { name: ":moneybag:  Sale Price", value: `**${price.toFixed(2)} SOL**`, inline: true },
        { name: ":date:  Sale Date", value: formattedDate, inline: true },
        { name: "Buyer", value: `${buyer}`, inline: false },
        { name: "Seller", value: `${seller}`, inline: false },
        // { name: "Marketplace", value: `Sold via ${marketplace}`, inline: false }
      ],
      image: { url: image },
      timestamp: new Date().toISOString(),
      footer: { 
        text: `MonkeSales: Sold via ${marketplace}`,
        icon_url: "https://media.discordapp.net/attachments/1058514014092668958/1248039086930006108/logo.png?ex=66623679&is=6660e4f9&hm=f68083d86a2856a80cb4d04bdb71e2361f39bf5cf136dd293b24346a8b051827&=&format=webp&quality=lossless&width=487&height=487" },
    }],
  };

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
