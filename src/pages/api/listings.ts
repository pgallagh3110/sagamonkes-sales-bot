import { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "../../../utils/mongoConnect";
import traitData from "../../../utils/traits";

export const maxDuration = 60; // 60 seconds
export const dynamic = "force-dynamic";

const dbCollection = "listings";
const collection = process.env.COLLECTION_NFT;
const apiKey = "sagamonkes_sk_9rqtif6tj0zq310u07t0gg72jrg5fl1a";

const SIMPLEHASH_API_URL = `https://api.simplehash.com/api/v0/nfts/listing_events/collection/${collection}?limit=50`;

const headers = new Headers({
  accept: "application/json",
  "X-API-KEY": apiKey || "",
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Activity {
  id: string;
  nft_id: string;
  collection_id: string;
  event_timestamp: string;
  seller_address: string;
  price: number;
  marketplace_id: string;
  permalink: string;
  createdAt: Date;
  nft_details?: any; // Add the nft_details property as optional
}

interface Attribute {
  trait_type: string;
  value: string;
}

interface TraitValue {
  value: string;
  count: number;
  role?: string;
}

interface Trait {
  trait_type: string;
  values: TraitValue[];
}

interface NftDetails {
  extra_metadata: {
    attributes: Attribute[];
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const client = await getClient();
    const db = client.db();
    const collection = db.collection(dbCollection);

    let activities;

    if (req.query.test === "true") {
      activities = req.body;
      console.log("Test Activities:", activities);
    } else {
      const response = await fetch(SIMPLEHASH_API_URL, {
        method: "GET",
        headers: headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error fetching activities:", response.status, errorText);
        return res
          .status(response.status)
          .json({ error: "Failed to fetch activities" });
      }

      const data = await response.json();
      activities = data.events;
      console.log("Fetched Activities:", activities);
    }

    if (!Array.isArray(activities)) {
      console.error("Activities is not an array:", activities);
      return res.status(400).json({ error: "Invalid data format" });
    }

    for (const activity of activities) {
      if (activity.event_type === "listing_added") {
        const existingActivity = await collection.findOne({ id: activity.id });

        const nftAddress = activity.nft_id.slice(7);

        if (!existingActivity) {
          const newActivity: Activity = {
            id: activity.id,
            nft_id: nftAddress,
            collection_id: activity.collection_id,
            event_timestamp: activity.event_timestamp,
            seller_address: activity.seller_address,
            price: activity.price / 10 ** activity.payment_token.decimals,
            marketplace_id: activity.marketplace_id,
            permalink: activity.permalink,
            createdAt: new Date(),
          };

          ///get nft details//
          const SIMPLEHASH_API_URL_NFT = `https://api.simplehash.com/api/v0/nfts/solana/${nftAddress}`;
          const response2 = await fetch(SIMPLEHASH_API_URL_NFT, {
            method: "GET",
            headers: headers,
          });

          if (!response2.ok) {
            const errorText = await response2.text();
            console.error(
              "Error fetching nftDetails:",
              response2.status,
              errorText
            );
            return res
              .status(response2.status)
              .json({ error: "Failed to fetch nftDetails" });
          }

          const nftDetails = await response2.json();
          console.log("Fetched NFT Details:", nftDetails);

          // Merge the NFT details with newActivity
          newActivity.nft_details = nftDetails; // Add this line

          await collection.insertOne(newActivity);

          await sendToDiscord({ ...activity, nft_details: nftDetails }); // Pass the details to the Discord function

          await delay(500); // 0.5 second delay
        }
      }
    }

    res.status(200).json({ message: "Success" });
  } catch (error) {
    console.error("Error fetching activities or sending to Discord:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

async function sendToDiscord(activity: any) {
  const webhook = process.env.DISCORD_WEBHOOK_2;

  if (!webhook) {
    console.error("DISCORD_WEBHOOK is not defined");
    return;
  }

  const {
    nft_id,
    price,
    seller_address,
    permalink,
    event_timestamp,
    marketplace_id,
    nft_details, // Add this line to destructure nft_details
  } = activity;

  const formattedDate = new Date(event_timestamp).toLocaleDateString("en-US");

  let marketplace;
  if (marketplace_id.toLowerCase().includes("tensor")) {
    marketplace = "Tensor";
  } else if (marketplace_id.toLowerCase().includes("magic")) {
    marketplace = "MagicEden";
  } else {
    marketplace = "Other";
  }

  //traits
  const traits = nft_details.extra_metadata.attributes
    .map((attr: { trait_type: string; value: string }) => {
      return `**${attr.trait_type}**: ${attr.value}`;
    })
    .join("\n");

  // Look up roles associated with attributes
  const roles = nft_details.extra_metadata.attributes.map((attr: Attribute) => {
    const trait = traitData.items.find((item: Trait) => item.trait_type === attr.trait_type);
    if (trait) {
      const value = trait.values.find((val: TraitValue) => val.value === attr.value);
      if (value && value.role) {
        return `<@&${value.role}>`;
      }
    }
    return null;
  }).filter((role: string | null): role is string => role !== null);

  const roleMentions = roles.join(" ");

  const content = roleMentions ? `${roleMentions}, your followed trait has been listed on ${marketplace}` : null;
  
  const embed = {
    content: content, // Use the conditional content
    embeds: [
      {
        title: `${nft_details.contract.name} has been listed!`,
        url: permalink,
        color: 8388736,
        fields: [
          {
            name: ":moneybag: New Price",
            value: `${(price / 10 ** activity.payment_token.decimals).toFixed(
              2
            )} ◎`,
            inline: true,
          },
          { name: ":date: Change Date", value: formattedDate, inline: true },
          { name: "Seller", value: `${seller_address}`, inline: false },
          { name: "Attributes", value: traits, inline: false },
          // Add more fields from nft_details if needed
        ],
        image: { url: nft_details.extra_metadata.image_original_url },
        timestamp: new Date().toISOString(),
        footer: {
          text: `Listed on ${marketplace}`,
          icon_url:
            "https://media.discordapp.net/attachments/1058514014092668958/1248039086930006108/logo.png?ex=66623679&is=6660e4f9&hm=f68083d86a2856a80cb4d04bdb71e2361f39bf5cf136dd293b24346a8b051827&=&format=webp&quality=lossless&width=487&height=487",
        },
      },
    ],
  };

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(embed),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook response not OK: ${response.statusText}`);
  }

  console.log("Discord response status:", response.status);
}
