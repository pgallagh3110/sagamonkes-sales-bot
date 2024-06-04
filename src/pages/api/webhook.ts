import { NextApiRequest, NextApiResponse } from 'next';


const rpc = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_KEY}`;

const getAsset = async (token: string) => {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getAsset',
      params: { id: token },
    }),
  });
  const { result } = await response.json();
  return result;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const webhook = process.env.DISCORD_WEBHOOK;

    if (!webhook) {
      console.error('DISCORD_WEBHOOK is not defined');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    try {
      const webhookData = req.body;

      console.log(webhookData, 'Received data');

      const token = await getAsset(webhookData.events.nft.nfts[0].mint);

      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: null,
          embeds: [{
            title: `${token.content.metadata.name} has sold!`,
            url: `https://solscan.io/token/${webhookData.events.nft.nfts[0].mint}`,
            color: 16486972,
            fields: [
              { name: " ", value: " " },
              { name: ":moneybag:  Sale Price", value: `**${(webhookData.events.nft.amount / 1000000000).toFixed(2)} SOL**`, inline: true },
              { name: ":date:  Sale Date", value: `<t:${webhookData.timestamp}:R>`, inline: true },
              { name: "Buyer", value: `${webhookData.events.nft.buyer.slice(0, 4)}..${webhookData.events.nft.buyer.slice(-4)}`, inline: true },
              { name: "Seller", value: `${webhookData.events.nft.seller.slice(0, 4)}..${webhookData.events.nft.seller.slice(-4)}`, inline: true }
            ],
            image: { url: token.content.files[0].uri },
            timestamp: new Date().toISOString(),
            footer: { text: "Helius", icon_url: "https://assets-global.website-files.com/641a8c4cac3aee8bd266fd58/642b5b2804ea37191a59737b_favicon-32x32.png" }
          }],
        }),
      });

      console.log('Discord response:', response.status);
      res.status(200).json({ message: 'Success' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
