// Type a string into a target input or contentEditable element one character
// at a time, dispatching events that React's reconciler observes so the
// product's controlled input state stays in sync.
//
// React intercepts native value setters on <input>/<textarea> via a
// prototype-level descriptor, then dispatches 'input' events to its own
// synthetic event system. To make a fake change visible to React, we
// have to invoke the native setter via the prototype descriptor and then
// dispatch a real 'input' event. Setting `el.value = ...` directly is
// silently ignored by React's onChange.

const INPUT_PROTO_VALUE_DESC =
  typeof window !== 'undefined'
    ? Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )
    : undefined;

const TEXTAREA_PROTO_VALUE_DESC =
  typeof window !== 'undefined'
    ? Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )
    : undefined;

function nativeSetValue(el: HTMLElement, value: string): void {
  if (el instanceof HTMLInputElement && INPUT_PROTO_VALUE_DESC?.set) {
    INPUT_PROTO_VALUE_DESC.set.call(el, value);
  } else if (
    el instanceof HTMLTextAreaElement &&
    TEXTAREA_PROTO_VALUE_DESC?.set
  ) {
    TEXTAREA_PROTO_VALUE_DESC.set.call(el, value);
  } else {
    (el as HTMLInputElement).value = value;
  }
}

function dispatchInput(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// contentEditable fields (the agent chat input is one) need a different
// path. Setting textContent doesn't fire any of the events React's
// onInput handler listens for, AND it nukes any rich-content children
// (skill pills, etc). document.execCommand('insertText') is the
// idiomatic way to programmatically type into a contentEditable — it
// fires the same `input` events a real keystroke would.
function insertContentEditableText(el: HTMLElement, ch: string): void {
  el.focus();
  // Place caret at end so insertion appends rather than overwrites.
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // execCommand is deprecated but still the only cross-browser way to
  // get React-friendly synthetic input events into a contentEditable.
  // Falls back to direct text-node append if execCommand is rejected
  // (some embedded webviews disable it).
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, ch);
  } catch {
    ok = false;
  }
  if (!ok) {
    el.appendChild(document.createTextNode(ch));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
  }
}

export interface TypeIntoOptions {
  speedMs?: number;
  // Optional callback fired after each character — lets the cursor
  // re-align to the input's right edge as text grows.
  onTick?: () => void;
}

export async function typeInto(
  el: HTMLElement,
  text: string,
  opts: TypeIntoOptions = {},
): Promise<void> {
  // Default char-cadence — faster than the original 40ms (which felt
  // like watching molasses for long URLs). 18ms is still slow enough to
  // read live but doesn't make typing the main bottleneck of the step.
  const speed = opts.speedMs ?? 18;
  el.focus();

  // Branch on element kind. contentEditable (the agent ChatInput uses
  // a contentEditable div for skill-pill support) requires execCommand;
  // <input>/<textarea> require the React-prototype-setter dance.
  if (el.isContentEditable) {
    for (const ch of text) {
      insertContentEditableText(el, ch);
      opts.onTick?.();
      await new Promise((r) => window.setTimeout(r, speed));
    }
    return;
  }

  let acc = '';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    acc = el.value ?? '';
  }
  for (const ch of text) {
    acc += ch;
    nativeSetValue(el, acc);
    dispatchInput(el);
    opts.onTick?.();
    await new Promise((r) => window.setTimeout(r, speed));
  }
}
