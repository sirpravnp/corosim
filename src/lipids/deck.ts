import { svgG } from "./glyphs";
import { APONAME, BACKS, MOLS, molSVG } from "./molecules";

/**
 * The lipoprotein card deck: one card at a time with its neighbors to each side. Arrows, swipe or the arrow keys move through it;
 * clicking the center card (or Enter) flips it to what the particle does, what it binds, which drugs change it and a clinical pearl.
 */
export function mountDeck(deck: HTMLElement, track: HTMLElement, count: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement) {
  const no = (i: number) => `No. ${String(i + 1).padStart(2, "0")}`;
  track.innerHTML = MOLS.map((m, i) => {
    const b = BACKS[i];
    const hd = `<div class="hd"><span>${no(i)}</span><span>${b.fam}</span></div><h3>${m.name}</h3>`;
    return `<div class="card" data-i="${i}" role="group" aria-roledescription="card" aria-label="${m.name}">
      <div class="card-inner">
        <div class="face front">${hd}
          <div class="pic-wrap">${molSVG(m, 180)}</div>
          <dl><dt>Diameter</dt><dd>${m.d}</dd><dt>Density</dt><dd>${m.dens} g/mL</dd><dt>Core TG:CE</dt><dd>${m.core}</dd><dt>From</dt><dd>${m.src}</dd></dl>
          <div class="chips">${[...new Set(m.apos)].map((a) => `<span class="chip">${svgG(a)}${APONAME[a]}</span>`).join("")}</div>
          <div class="ft"><span>Click to flip</span><span>${i + 1} / ${MOLS.length}</span></div>
        </div>
        <div class="face back">${hd}
          <div class="body">
            <p>${b.what}</p>
            <div class="sub">Binds</div><div class="binds">${b.binds.map(([a, r, t]) => `<span class="bind">${svgG(a)}${svgG(r)}${t}</span>`).join("")}</div>
            <div class="sub">Changed by</div><p>${b.drugs}</p>
            <div class="sub">Clinical</div><p>${b.pearl}</p>
          </div>
          <div class="ft"><span>Click to flip back</span><span>${i + 1} / ${MOLS.length}</span></div>
        </div>
      </div></div>`;
  }).join("");
  const cards = Array.from(track.children) as HTMLElement[];
  let idx = 0;
  function layout() {
    const gap = deck.clientWidth < 640 ? 190 : 250;
    cards.forEach((c, i) => {
      const off = i - idx, a = Math.abs(off);
      c.style.transform = `translateX(${off * gap}px) scale(${off === 0 ? 1 : 0.84})`;
      c.style.opacity = String(a > 2 ? 0 : off === 0 ? 1 : a === 1 ? 0.5 : 0.22);
      c.style.zIndex = String(10 - a); c.style.pointerEvents = a > 2 ? "none" : "auto";
      c.setAttribute("aria-hidden", String(a > 0));
      if (off !== 0) c.classList.remove("flipped");
    });
    count.textContent = `${idx + 1} / ${cards.length}`;
  }
  const go = (i: number) => { idx = (i + cards.length) % cards.length; layout(); };
  prev.addEventListener("click", () => go(idx - 1));
  next.addEventListener("click", () => go(idx + 1));
  track.addEventListener("click", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".card"); if (!c) return;
    const i = Number(c.dataset.i); if (i !== idx) go(i); else c.classList.toggle("flipped");
  });
  deck.tabIndex = 0;
  deck.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { go(idx - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { go(idx + 1); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === " ") { cards[idx].classList.toggle("flipped"); e.preventDefault(); }
  });
  let sx: number | null = null;
  deck.addEventListener("pointerdown", (e) => { sx = e.clientX; });
  deck.addEventListener("pointerup", (e) => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1)); });
  new ResizeObserver(layout).observe(deck);
  layout();
}
