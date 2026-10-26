/* Replaces each native <select> with a styled listbox so the open menu matches the console instead of the OS.
   The <select> stays in the DOM as the source of truth: app code keeps reading `.value`, setting it, rewriting its
   options and listening for "change"; the custom control mirrors all of that. */
const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!;

let autoId = 0;
function enhance(sel: HTMLSelectElement) {
  if (sel.classList.contains("dd-native") || sel.multiple) return; // already enhanced (or a list box, which stays native)
  if (!sel.id) sel.id = `dd-auto-${++autoId}`;
  const wrap = document.createElement("div");
  wrap.className = "dd";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dd-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "dd-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  const id = sel.id;
  list.id = `${id}-list`;
  btn.setAttribute("aria-controls", list.id);
  sel.parentNode!.insertBefore(wrap, sel);
  wrap.append(sel, btn, list);
  sel.classList.add("dd-native");
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");
  // keep <label for=id> working: point it at the visible button
  const lab = document.querySelector(`label[for="${id}"]`);
  if (lab) { btn.id = `${id}-btn`; lab.setAttribute("for", btn.id); }

  let active = -1;
  const items = () => Array.from(list.querySelectorAll<HTMLElement>('li[role="option"]'));
  const opts = () => Array.from(sel.options);

  function render() {
    list.innerHTML = "";
    let group: HTMLOptGroupElement | null = null;
    opts().forEach((o, i) => {
      // <optgroup> labels become headings in the list; they are not choosable
      const g = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
      if (g && g !== group) {
        const h = document.createElement("li");
        h.className = "dd-group"; h.setAttribute("role", "presentation"); h.textContent = g.label;
        list.append(h);
      }
      group = g;
      const li = document.createElement("li");
      li.hidden = o.hidden; // an option the page hides (e.g. "custom" until a link brings one); kept so indices match
      li.setAttribute("role", "option");
      li.textContent = o.textContent;
      li.dataset.i = String(i);
      li.setAttribute("aria-selected", String(o.selected));
      list.append(li);
    });
    btn.textContent = sel.selectedOptions[0]?.textContent ?? "";
    btn.disabled = sel.disabled;
  }
  function highlight(i: number) {
    active = Math.max(0, Math.min(i, opts().length - 1));
    items().forEach((li, k) => li.classList.toggle("act", k === active));
    items()[active]?.scrollIntoView({ block: "nearest" });
  }
  function open() {
    if (!list.hidden) return;
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    highlight(sel.selectedIndex);
  }
  function close(focus = false) {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focus) btn.focus();
  }
  function choose(i: number) {
    if (i !== sel.selectedIndex) {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    render();
    close(true);
  }

  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[role="option"]');
    if (li) choose(+li.dataset.i!);
  });
  list.addEventListener("mousemove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[role="option"]');
    if (li) highlight(+li.dataset.i!);
  });
  btn.addEventListener("keydown", (e) => {
    const n = opts().length;
    if (list.hidden) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Home") { e.preventDefault(); highlight(0); }
    else if (e.key === "End") { e.preventDefault(); highlight(n - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") close();
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const hit = opts().findIndex((o, i) => i > active && (o.textContent ?? "").toLowerCase().startsWith(k));
      const first = hit >= 0 ? hit : opts().findIndex((o) => (o.textContent ?? "").toLowerCase().startsWith(k));
      if (first >= 0) highlight(first);
    }
  });
  document.addEventListener("mousedown", (e) => { if (!wrap.contains(e.target as Node)) close(); });
  btn.addEventListener("blur", () => { if (!list.matches(":hover")) close(); });

  // app code sets .value directly (presets) and rewrites options (vessel list): mirror both
  Object.defineProperty(sel, "value", {
    get() { return valueDesc.get!.call(this); },
    set(v: string) { valueDesc.set!.call(this, v); render(); },
  });
  new MutationObserver(render).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "label"] });
  render();
}

document.querySelectorAll<HTMLSelectElement>("select").forEach(enhance);
// Selects built later (the patient controls, panel pickers) get the same control as soon as they are in the page.
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) {
    if (n instanceof HTMLSelectElement) enhance(n);
    else if (n instanceof HTMLElement) n.querySelectorAll<HTMLSelectElement>("select").forEach(enhance);
  }
}).observe(document.body, { childList: true, subtree: true });
