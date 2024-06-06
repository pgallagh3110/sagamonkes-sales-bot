import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

const rpc = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_KEY}`;
const SHYFT_API_KEY = process.env.SHYFT_API_KEY as string;
const NETWORK = "mainnet-beta";
const CACHE_DURATION = 20 * 1000; // 1 minute

const requestCache: { [key: string]: number } = {};

// GET PARSED TRANSACTION
async function getParsed(signature: string, network: string) {
  try {
    const response = await axios.get(
      `https://api.shyft.to/sol/v1/transaction/parsed?network=${network}&txn_signature=${signature}`,
      {
        headers: {
          "x-api-key": SHYFT_API_KEY,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      `Error fetching parsed data for address ${signature}:`,
      error
    );
    throw new Error("Failed to parse CNFT data");
  }
}

const getAsset = async (token: string) => {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "my-id",
      method: "getAsset",
      params: { id: token },
    }),
  });
  const { result } = await response.json();
  return result;
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const month = date.getUTCMonth() + 1; // Months are zero-based
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const webhook = process.env.DISCORD_WEBHOOK;

    if (!webhook) {
      console.error("DISCORD_WEBHOOK is not defined");
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // console.log("DISCORD_WEBHOOK:", webhook); // Log the webhook URL

    try {
      const webhookData = req.body;
      // console.log('Received data:', webhookData);

      // Extract the first signature
      const firstSignature = webhookData[0].signature;
      if (!firstSignature) {
        console.error('No signatures found in the data:', webhookData);
        return res.status(400).json({ error: 'No signatures found' });
      }
      // console.log('First signature:', firstSignature);

      // Deduplication check
      if (requestCache[firstSignature] && Date.now() - requestCache[firstSignature] < CACHE_DURATION) {
        console.log('Duplicate request detected:', firstSignature);
        return res.status(200).json({ message: 'Duplicate request ignored' });
      }

      // Update cache
      requestCache[firstSignature] = Date.now();

      // Get parsed transaction
      const parsed = await getParsed(firstSignature, NETWORK);
      console.log('Parsed transaction:', JSON.stringify(parsed, null, 2));

      // Accessing the first action's info
      const actionInfo = parsed.result.actions[0]?.info;
      if (!actionInfo) {
        console.error('No action info found in the parsed data:', parsed);
        return res.status(400).json({ error: 'No action info found' });
      }
      // console.log('Action info:', actionInfo);

      if (parsed.result.actions[0]?.type !== 'COMPRESSED_NFT_SALE' && parsed.result.actions[0]?.type !== 'COMPRESSED_NFT_TAKE_BID') {
        console.error('No COMPRESSED_NFT_SALE or COMPRESSED_NFT_TAKE_BID found in the parsed data');
        return res.status(400).json({ error: 'No action info found' });
      }
      console.log('COMPRESSED_NFT_SALE or COMPRESSED_NFT_TAKE_BID found');

      const { buyer, seller, nft_address: mintAddress, price: amount } = actionInfo;

      const token = await getAsset(mintAddress);
      console.log('token', token);

      const formattedDate = formatDate(parsed.result.timestamp);

      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: null,
          embeds: [{
            title: `${token.content.metadata.name} has sold!`,
            url: `https://solscan.io/token/${mintAddress}`,
            color: 16486972,
            fields: [
              { name: ":moneybag:  Sale Price", value: `**${(amount).toFixed(2)} SOL**`, inline: true },
              { name: ":date:  Sale Date", value: formattedDate, inline: true },
              { name: "Buyer", value: `${buyer}`, inline: false },
              { name: "Seller", value: `${seller}`, inline: false }
            ],
            image: { url: token.content.files[0].uri },
            timestamp: new Date().toISOString(),
            footer: { text: "MonkeSales", icon_url: "https://media.discordapp.net/attachments/1058514014092668958/1248039086930006108/logo.png?ex=66623679&is=6660e4f9&hm=f68083d86a2856a80cb4d04bdb71e2361f39bf5cf136dd293b24346a8b051827&=&format=webp&quality=lossless&width=487&height=487" }
          }],
        }),
      });

      console.log("Discord response status:", response.status);
      if (!response.ok) {
        const responseBody = await response.text();
        console.error(`Discord webhook response not OK: ${response.statusText}, Body: ${responseBody}`);
        throw new Error(`Discord webhook response not OK: ${response.statusText}`);
      }

      res.status(200).json({ message: "Success" });
    } catch (err) {
      console.error('Error sending data to Discord:', err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  } else {
    res.status(405).json({ error: "Method Not Allowed" });
  }
}

///ProgramID: M3mxk5W2tt27WGT7THox7PmgRDp4m6NEhL5xvxrBfS1 (MagicEden?)
///ProgramID: TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp (Tensor)
