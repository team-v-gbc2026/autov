export const mentionPattern = /@\[([^\]]*)\]\(reference:([0-9a-f-]{36})\)/gi;
export function encodeMention(id: string, name: string) { return `@[${name.replace(/[\[\]\r\n]/g, " ")}](reference:${id})`; }
export function displayPrompt(prompt: string) { return prompt.replace(mentionPattern, (_match, name: string) => `@${name}`); }
