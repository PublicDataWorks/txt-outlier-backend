import { SlackAPI } from "slackAPI";
import { markdownTemplate } from "../templates/slack.ts";

export interface ErrorDetail {
  failureDetails: string;
}

const slack = async function sendToSlack(
  data: ErrorDetail,
) {
  const client = SlackAPI(Deno.env.get("SLACK_API_TOKEN")!);

  const errorChat = replacePlaceholders(markdownTemplate, data);
  const result = await client.chat.postMessage({
    channel: Deno.env.get("SLACK_CHANNEL")!,
    text: errorChat,
  });
  if (!result.ok) {
    throw new Error(`Failed to send message: ${result}`);
  }
};

function replacePlaceholders(
  template: string,
  replacements: ErrorDetail,
): string {
  return template.replace(/<%=\s*(\w+)\s*%>/g, (match, p1) => {
    return replacements[p1] !== undefined ? replacements[p1] : match;
  });
}

export default slack;
