// factories/conversation.ts
import { faker } from "faker";
import { conversations } from "../../_shared/drizzle/schema.ts";
import supabase from "../../_shared/lib/supabase.ts";

type CreateConversationParams = {
  createdAt?: string;
};

export const createConversation = async (
  { createdAt }: CreateConversationParams = {},
) => {
  const [result] = await supabase
    .insert(conversations)
    .values({
      webUrl: faker.internet.url(), // Required field
      appUrl: faker.internet.url(), // Required field
      // Optional fields can be added if needed
      subject: faker.lorem.sentence(),
      messagesCount: 0,
      draftsCount: 0,
      sendLaterMessagesCount: 0,
      attachmentsCount: 0,
      tasksCount: 0,
      completedTasksCount: 0,
      ...(createdAt ? { createdAt } : {}),
    })
    .returning();

  return result;
};
