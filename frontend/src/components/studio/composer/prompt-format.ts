export const mentionPattern = /@\[([^\]]*)\]\(reference:([0-9a-f-]{36})\)/gi;
export function encodeMention(id: string, name: string) { return `@[${name.replace(/[\[\]\r\n]/g, " ")}](reference:${id})`; }
export const emitterMentionPattern = /#\[([^\]]*)\]\(emitter:([^\s)]+)\)/g;
export function encodeEmitterMention(id: string, name: string) { return `#[${name.replace(/[\[\]\r\n]/g, " ")}](emitter:${encodeURIComponent(id).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)})`; }
export function displayPrompt(prompt: string) {
  return prompt.replace(mentionPattern, (_match, name: string) => `@${name}`)
    .replace(emitterMentionPattern, (_match, name: string) => `#${name}`);
}
