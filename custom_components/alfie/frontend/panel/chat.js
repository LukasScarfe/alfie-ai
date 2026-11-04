// The panel's Chat section: typed chat with Alfie, the same <alfie-chat> as
// custom:alfie-chat-card (alfie-chat.js). It has no settings of its own; the
// conversation is the admin's own (per HA user), shared with their chat cards.

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
await import(`../alfie-chat.js${V}`);

export const id = "chat";
export const title = "Chat";
export const subs = [];
export const resets = {};

export function render() {
  return `${U.intro("Type to Alfie: questions about the house, or anything else. It goes the way a voice request does (his own answers, then the agent server, or the delegate when that's away), with the saved settings, and things do happen.",
      "Follow-ups carry on the same conversation; New chat starts over. The chat is yours: it follows you to an Alfie chat card on any dashboard. The Ask box in Voice → Brain is still there for a one-off test.")}
    <div class="card chatbox"><alfie-chat></alfie-chat></div>
    <style>.card.chatbox { padding: 0; display: flex; height: max(420px, calc(100vh - 260px)); overflow: hidden; }
      .card.chatbox alfie-chat { flex: 1; }</style>`;
}

export function mount(p) {
  const el = p.root.querySelector("alfie-chat");
  if (!el) return;
  el.hass = p.hass;
  el.options = { show_starters: "empty" };
}
