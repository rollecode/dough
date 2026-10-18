// The classes for an amount the AI marks by its kind, as a link to #expense, #income or #transfer.
// Shared by the chat and the daily report so both colour money the same way.
export const AMOUNT_KINDS: Record<string, string> = {
  "#expense": "chat-amount-negative",
  "#income": "chat-amount-positive",
  "#transfer": "chat-amount-transfer",
};
