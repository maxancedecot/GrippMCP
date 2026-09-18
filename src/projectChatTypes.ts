export type ProjectChatMessage = { role: "user" | "assistant"; content: string };

export type ProjectChatSource = {
  tool: string;
  entity?: string;
  status: "success" | "error";
};

export type ProjectChatEvent =
  | { type: "status"; message: string }
  | { type: "answer"; text: string; sources: ProjectChatSource[] }
  | { type: "error"; message: string };

export const PROJECT_CHAT_MAX_MESSAGE_LENGTH = 8000;
export const PROJECT_CHAT_MAX_MESSAGES = 21;
