type GatewayHistoryRole = 'user' | 'assistant' | 'system';

export interface GatewayHistoryEntry {
  role: GatewayHistoryRole;
  text: string;
}

const SCHEDULED_REMINDER_PREFIX = 'A scheduled reminder has been triggered. The reminder content is:';
const SCHEDULED_REMINDER_INTERNAL_INSTRUCTION = 'Handle this reminder internally. Do not relay it to the user unless explicitly requested.';
const SCHEDULED_REMINDER_RELAY_INSTRUCTION = 'Please relay this reminder to the user in a helpful and friendly way.';
const CURRENT_TIME_PREFIX = 'Current time:';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

export const extractGatewayMessageText = (message: unknown): string => {
  if (typeof message === 'string') {
    return message;
  }
  if (!isRecord(message)) {
    return '';
  }

  const content = message.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const item of content) {
      if (!isRecord(item)) continue;
      if (item.type === 'text' && typeof item.text === 'string') {
        chunks.push(item.text);
      }
    }
    if (chunks.length > 0) {
      return chunks.join('\n');
    }
  }
  if (typeof message.text === 'string') {
    return message.text;
  }
  return '';
};

type ScheduledReminderPrompt = {
  reminderText: string;
  currentTime?: string;
};

const parseScheduledReminderPrompt = (text: string): ScheduledReminderPrompt | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(SCHEDULED_REMINDER_PREFIX)) {
    return null;
  }

  let remainder = trimmed.slice(SCHEDULED_REMINDER_PREFIX.length).trim();
  let currentTime: string | undefined;
  const currentTimeIndex = remainder.lastIndexOf(CURRENT_TIME_PREFIX);
  if (currentTimeIndex >= 0) {
    currentTime = remainder.slice(currentTimeIndex + CURRENT_TIME_PREFIX.length).trim() || undefined;
    remainder = remainder.slice(0, currentTimeIndex).trim();
  }

  if (remainder.endsWith(SCHEDULED_REMINDER_INTERNAL_INSTRUCTION)) {
    remainder = remainder.slice(0, -SCHEDULED_REMINDER_INTERNAL_INSTRUCTION.length).trim();
  } else if (remainder.endsWith(SCHEDULED_REMINDER_RELAY_INSTRUCTION)) {
    remainder = remainder.slice(0, -SCHEDULED_REMINDER_RELAY_INSTRUCTION.length).trim();
  }

  if (!remainder) {
    return null;
  }

  return {
    reminderText: remainder,
    ...(currentTime ? { currentTime } : {}),
  };
};

export const buildScheduledReminderSystemMessage = (text: string): string | null => {
  const parsed = parseScheduledReminderPrompt(text);
  if (!parsed) {
    return null;
  }

  const lines = [
    `System: ${parsed.currentTime ? `[${parsed.currentTime}] ` : ''}${parsed.reminderText}`,
    '',
    SCHEDULED_REMINDER_PREFIX,
    '',
    parsed.reminderText,
    '',
    SCHEDULED_REMINDER_RELAY_INSTRUCTION,
  ];

  if (parsed.currentTime) {
    lines.push(`${CURRENT_TIME_PREFIX} ${parsed.currentTime}`);
  }

  return lines.join('\n');
};

export const extractGatewayHistoryEntry = (message: unknown): GatewayHistoryEntry | null => {
  if (!isRecord(message)) {
    return null;
  }

  const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null;
  }

  const text = extractGatewayMessageText(message).trim();
  if (!text) {
    return null;
  }

  const reminderSystemMessage = role === 'user'
    ? buildScheduledReminderSystemMessage(text)
    : null;
  if (reminderSystemMessage) {
    return {
      role: 'system',
      text: reminderSystemMessage,
    };
  }

  return {
    role,
    text,
  };
};

export const extractGatewayHistoryEntries = (messages: unknown[]): GatewayHistoryEntry[] => {
  return messages
    .map((message) => extractGatewayHistoryEntry(message))
    .filter((entry): entry is GatewayHistoryEntry => entry !== null);
};
