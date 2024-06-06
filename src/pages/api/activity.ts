import { NextApiRequest, NextApiResponse } from "next";

const collection = process.env.COLLECTION;

const MAGICEDEN_API_URL = `https://api-mainnet.magiceden.dev/v2/collections/${collection}/activities?offset=0&limit=20`;

const signatureSet = new Set<string>();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    let activities;

//testing
    if (req.query.test === 'true') {
      activities = req.body;
    //   console.log('Test Activities:', activities);
    } else {
      // Fetch data from Magic Eden API
      const response = await fetch(MAGICEDEN_API_URL);
      activities = await response.json();
    //   console.log('Fetched Activities:', activities);
    }

    // Ensure activities is an array
    if (!Array.isArray(activities)) {
      console.error('Activities is not an array:', activities);
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const newSignatures = new Set<string>();
    for (const activity of activities) {
      newSignatures.add(activity.signature);
    }

    // console.log('New Signatures:', newSignatures);

    for (const signature of signatureSet) {
      if (!newSignatures.has(signature)) {
        signatureSet.delete(signature);
      }
    }

    // console.log('Updated Signature Set:', signatureSet);

    let postedToDiscord = false;

    for (const activity of activities) {
    //   console.log('Processing Activity:', activity);
      if (activity.type === 'buyNow' && !signatureSet.has(activity.signature)) {
        // console.log('Found new buyNow activity:', activity);
        signatureSet.add(activity.signature);

        await sendToDiscord(activity);
        postedToDiscord = true;

        // Add delay to avoid rate limiting
        await delay(1000); // 1 second delay
      }
    }

    if (!postedToDiscord) {
      console.log('No new buyNow activities to post to Discord.');
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

  const { tokenMint, price, buyer, seller, image, blockTime } = activity;

  const formattedDate = new Date(blockTime * 1000).toLocaleDateString("en-US");
  const monkeNumber = image.match(/(\d+)\.png$/)?.[1];

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
        { name: "Seller", value: `${seller}`, inline: false }
      ],
      image: { url: image },
      timestamp: new Date().toISOString(),
      footer: { text: "MonkeSales", icon_url: "https://media.discordapp.net/attachments/1058514014092668958/1248039086930006108/logo.png?ex=66623679&is=6660e4f9&hm=f68083d86a2856a80cb4d04bdb71e2361f39bf5cf136dd293b24346a8b051827&=&format=webp&quality=lossless&width=487&height=487" }
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
