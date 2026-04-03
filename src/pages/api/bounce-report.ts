import { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "../../../utils/mongoConnect";

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await getClient();
    const db = client.db();
    const col = db.collection("bounce_mints");

    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const mints = await col.find({ createdAt: { $gte: since } }).toArray();

    if (mints.length === 0) {
      console.log("No Bounce mints in the last 12h");
      return res.status(200).json({ message: "No mints in last 12h" });
    }

    // Count by cosmetic name
    const counts: Record<string, number> = {};
    for (const mint of mints) {
      const name: string = mint.name ?? "Unknown";
      counts[name] = (counts[name] ?? 0) + 1;
    }

    // Sort by count desc, filter >0 (already guaranteed but explicit)
    const ranked = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a);

    const lines = [
      `🟣 <b>Bounce Cosmetics — Last 12h</b>`,
      ``,
      `📦 Total claimed: <b>${mints.length}</b>`,
      ``,
    ];

    for (const [name, count] of ranked) {
      lines.push(`• ${name}: <b>${count}</b>`);
    }

    const message = lines.join("\n");

    await sendTelegram(message);

    return res.status(200).json({ message: "Success", counts });
  } catch (err) {
    console.error("Error in bounce-report:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });

  if (!res.ok) {
    throw new Error(`Telegram error: ${res.statusText}`);
  }
}
