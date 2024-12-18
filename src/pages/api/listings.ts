import { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "../../../utils/mongoConnect";
import metadata from "../../../utils/metadata.json";  // Import metadata.json
import traitData from "../../../utils/traits";

export const maxDuration = 60; // 60 seconds
export const dynamic = "force-dynamic";

const dbCollection = "listings";
const collectionName = process.env.COLLECTION;

const MAGICEDEN_API_URL = `https://api-mainnet.magiceden.dev/v2/collections/${collectionName}/activities`;

const headers = new Headers({
  accept: "application/json",
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Activity {
  id: string;
  nft_id: string;
  collection_id: string;
  event_timestamp: string;
  seller_address: string;
  price: number;
  marketplace: string;
  permalink: string;
  createdAt: Date;
  nft_details?: any;
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
      const response = await fetch(MAGICEDEN_API_URL, {
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
      activities = data;
      console.log("Fetched Activities:", activities);
    }

    if (!Array.isArray(activities)) {
      console.error("Activities is not an array:", activities);
      return res.status(400).json({ error: "Invalid data format" });
    }

    for (const activity of activities) {
      if (activity.type === "list") {
        const nftAddress = activity.tokenMint;
        const sellerAddress = activity.seller;

        // Fetch the last 10 records with the same tokenMint
        const recentListings = await collection
          .find({ nft_id: nftAddress })
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray();

        // Check if the same tokenMint has been listed by the same seller
        const isDuplicateListing = recentListings.some(
          (listing) => listing.seller_address === sellerAddress
        );

        // Skip sending if the same tokenMint was listed by the same seller recently
        if (isDuplicateListing) {
          console.log(`Skipping duplicate listing for ${nftAddress} by ${sellerAddress}`);
          continue;
        }

        // Prepare the new activity object for the database
        const newActivity: Activity = {
          id: activity.signature,
          nft_id: nftAddress,
          collection_id: activity.collectionSymbol,
          event_timestamp: new Date(activity.blockTime * 1000).toISOString(),
          seller_address: sellerAddress,
          price: activity.priceInfo.solPrice.rawAmount / 10 ** 9,
          marketplace: activity.source,
          permalink: `https://magiceden.io/item-details/${nftAddress}`,
          createdAt: new Date(),
        };

        // Get NFT details from metadata.json based on mint address
        const nftDetails = metadata.find((nft) => nft.mint === nftAddress);

        if (!nftDetails) {
          console.error(`Metadata for NFT with address ${nftAddress} not found`);
          continue;  // Skip if no metadata is found
        }

        newActivity.nft_details = nftDetails;

        // Insert the new activity into the database
        await collection.insertOne(newActivity);

        // Send to Discord
        await sendToDiscord({ ...activity, nft_details: nftDetails });

        await delay(500); // 0.5-second delay
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
    marketplace,
    nft_details,
  } = activity;

  const formattedDate = new Date(activity.blockTime * 1000).toLocaleDateString("en-US");

  const traits = Object.entries(nft_details.attributes)
    .map(([trait_type, value]) => `**${trait_type}**: ${value}`)
    .join("\n");

  const roles = Object.entries(nft_details.attributes)
    .map(([trait_type, value]) => {
      const trait = traitData.items.find((item) => item.trait_type === trait_type);
      if (trait) {
        const traitValue = trait.values.find((val) => val.value === value);
        if (traitValue && traitValue.role) {
          return `<@&${traitValue.role}>`;
        }
      }
      return null;
    })
    .filter((role) => role !== null);

  const roleMentions = roles.join(" ");

  const content = roleMentions
    ? `${roleMentions}, your followed trait has been listed on ${marketplace}`
    : null;

  const embed = {
    content: content,
    embeds: [
      {
        title: `${nft_details.name} has been listed!`,
        url: permalink,
        color: 8388736,
        fields: [
          {
            name: ":moneybag: New Listing",
            value: `${price.toFixed(2)} ◎`,
            inline: true,
          },
          { name: ":date: Change Date", value: formattedDate, inline: true },
          { name: "Seller", value: `${seller_address}`, inline: false },
          { name: "Attributes", value: traits, inline: false },
        ],
        image: { url: activity.image },
        timestamp: new Date().toISOString(),
        footer: {
          text: `Listed on ${marketplace}`,
          icon_url:
            "https://media.discordapp.net/attachments/1058514014092668958/1248039086930006108/logo.png?format=webp&quality=lossless&width=487&height=487",
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
