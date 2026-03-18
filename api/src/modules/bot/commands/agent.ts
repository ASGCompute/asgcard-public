import type { TelegramClient } from "../telegramClient";

export async function handleAgentCommand(
    client: TelegramClient,
    chatId: number,
    userId: number
): Promise<void> {
    await client.sendMessage({
        chat_id: chatId,
        text: "🧠 <b>Agent Handoff</b>\n\nTo give your AI agent access to your ASG Card, provide your connected wallet address to the agent.\n\nThe <a href='https://github.com/asgcompute/x402-payments-skill'>x402-payments-skill</a> will automatically identify your connected card and use it for autonomous expenses with Zero Gas Fees.",
        parse_mode: "HTML"
    });
}
