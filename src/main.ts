import "./style.css";
import type { Analysis } from "@desert-ant-labs/eye";

/** Some dropped files arrive without a MIME type, so fall back to the extension. */
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif|tiff?)$/i;

/** Tag values that say nothing about what a photo *shows*, so they never become a group. */
const DESCRIPTIVE_EXTRAS = new Set([
  "reference",
  "reference_photo",
  "peak_moment",
  "keeper",
  "forgettable",
  "accidental",
  "technical_flaw",
  "unusable",
  "bad_framing",
  "bad_lighting",
  "test_or_duplicate_shot",
  "low_content",
  "sharp",
  "blurry",
  "bokeh",
  "rotated",
  "photo",
  "sensitive",
  "nsfw_explicit",
  "nsfw_suggestive",
  "blood_injury",
  "medical_hospital",
  "funeral",
  "accident_disaster",
  "violence_protest",
  "weapon",
]);

/** Photo kinds and people tags, checked before falling back to a scene. */
const KIND_ORDER = [
  "selfie",
  "screenshot",
  "photo_of_screen",
  "receipt",
  "document",
  "id_card",
  "whiteboard",
  "map",
  "chart_or_slide",
  "meme_or_graphic",
  "illustration_or_art",
  "group_shot",
  "portrait",
  "people",
];

/** Per-face tags: true of a person in the frame, not of what the photo is about. */
const FACET_TAGS = new Set(["smiling", "eyes_closed", "candid", "everyone_smiling", "everyone_looking", "looking_at_camera"]);

interface Photo {
  key: string;
  name: string;
  url: string;
  img: HTMLImageElement;
  card: HTMLButtonElement;
  analysis: Analysis | null;
  failed: boolean;
  labels: string[];
  confidence: number;
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
const button = document.querySelector<HTMLButtonElement>("#tag-button")!;
const overviewEl = document.querySelector<HTMLElement>("#overview")!;
const detailEl = document.querySelector<HTMLElement>("#detail")!;
const detailTitle = document.querySelector<HTMLElement>("#detail-title")!;
const detailCount = document.querySelector<HTMLElement>("#detail-count")!;
const detailGrid = document.querySelector<HTMLElement>("#detail-grid")!;
const detailBack = document.querySelector<HTMLButtonElement>("#detail-back")!;
const tilesEl = document.querySelector<HTMLElement>("#tiles")!;
const statPhotos = document.querySelector<HTMLElement>("#stat-photos")!;
const statTagged = document.querySelector<HTMLElement>("#stat-tagged")!;
const statUnsorted = document.querySelector<HTMLElement>("#stat-unsorted")!;
const statTags = document.querySelector<HTMLElement>("#stat-tags")!;
const progressEl = document.querySelector<HTMLElement>("#progress")!;
const progressFill = document.querySelector<HTMLElement>("#progress-fill")!;
const dropzone = document.querySelector<HTMLElement>("#dropzone")!;
const dropVeil = document.querySelector<HTMLElement>("#dropveil")!;
const pickPhotos = document.querySelector<HTMLButtonElement>("#pick-photos")!;
const pickFiles = document.querySelector<HTMLButtonElement>("#pick-files")!;
const pickFolder = document.querySelector<HTMLButtonElement>("#pick-folder")!;
const addFolder = document.querySelector<HTMLButtonElement>("#add-folder")!;
const clearCurrent = document.querySelector<HTMLButtonElement>("#clear-library")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const folderInput = document.querySelector<HTMLInputElement>("#folder-input")!;
const modal = document.querySelector<HTMLDialogElement>("#photo-modal")!;
const modalImage = document.querySelector<HTMLImageElement>("#modal-image")!;
const modalTitle = document.querySelector<HTMLElement>("#modal-title")!;
const modalSub = document.querySelector<HTMLElement>("#modal-sub")!;
const modalContent = document.querySelector<HTMLElement>("#modal-content")!;
const modalClose = document.querySelector<HTMLButtonElement>("#modal-close")!;

const photos: Photo[] = [];
let running = false;
let dragDepth = 0;

/** A tint per tag, so a card's destination is readable while it travels. */
const GROUP_PALETTE = [
  "#d7ff4a",
  "#6fd3ff",
  "#ff9ecb",
  "#ffcc66",
  "#7ce6b0",
  "#bfa6ff",
  "#ff9a75",
  "#9ab6ff",
];

// Declared up here, not beside render(): the bootstrap below runs before any
// later const is initialised.
const tiles = new Map<string, TileView>();
const groupColors = new Map<string, string>();
const ranks = new Map<string, number>();
let colorCursor = 0;
let selected: string | null = null;

syncChrome();
render();

button.addEventListener("click", tagImages);
pickPhotos.addEventListener("click", () => fileInput.click());
pickFiles.addEventListener("click", () => fileInput.click());
pickFolder.addEventListener("click", () => folderInput.click());
addFolder.addEventListener("click", () => folderInput.click());
clearCurrent.addEventListener("click", clearLibrary);
detailBack.addEventListener("click", () => openTag(null));
modalClose.addEventListener("click", () => modal.close());
modal.addEventListener("click", (event) => {
  // The dialog element itself is only hit outside the shell: that is the backdrop.
  if (event.target === modal) modal.close();
});
modal.addEventListener("close", () => {
  openedPhoto = null;
});
modal.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  stepPhoto(event.key === "ArrowRight" ? 1 : -1);
});
dropzone.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("button")) return;
  fileInput.click();
});

for (const input of [fileInput, folderInput]) {
  input.addEventListener("change", () => {
    const picked = [...(input.files ?? [])];
    input.value = "";
    void loadFiles(picked);
  });
}

// Anywhere on the page accepts a drop, not just the empty-state box.
window.addEventListener("dragenter", onDragEnter);
window.addEventListener("dragover", onDragOver);
window.addEventListener("dragleave", onDragLeave);
window.addEventListener("drop", onDrop);

void enableIsolation();

async function tagImages() {
  if (running) return;

  // Adding to a library leaves the earlier photos tagged, so a second run only
  // has to see the new ones.
  const pending = photos.filter((photo) => !photo.analysis && !photo.failed);
  if (!pending.length) {
    statusEl.textContent = "Everything here is already tagged.";
    return;
  }

  running = true;
  button.disabled = true;
  clearCurrent.disabled = true;
  progressEl.hidden = false;

  try {
    statusEl.textContent = "Loading the Eye model…";
    const { Eye } = await import("@desert-ant-labs/eye");
    const eye = await Eye.load({
      accelerator: "auto",
      onProgress: (fraction) => {
        setProgress(fraction);
        statusEl.textContent = `Downloading the Eye model… ${Math.round(fraction * 100)}%`;
      },
    });

    statusEl.textContent = "Tagging…";
    for (let i = 0; i < pending.length; i++) {
      const photo = pending[i];
      photo.card.classList.add("working");
      statusEl.textContent = `Tagging ${i + 1} of ${pending.length}…`;

      try {
        // analyze() decodes the element itself, so it has to be fully loaded first.
        await photo.img.decode().catch(() => {});
        photo.analysis = await eye.analyze(photo.img);
        const { labels, confidence } = describe(photo.analysis);
        photo.labels = labels;
        photo.confidence = confidence;
      } catch (error) {
        photo.failed = true;
        console.error(`Eye could not tag ${photo.name}`, error);
      }

      photo.card.classList.remove("working");
      paintCard(photo);
      // The counts move, not the photos: no grid is re-laid out mid-run.
      render();
      setProgress((i + 1) / pending.length);
    }

    // One final pass, now sorted by size: the only moment tiles change places.
    render(true);

    const { tags, failed } = totals();
    statusEl.textContent = `${photos.length} photos · ${tags} tag${tags === 1 ? "" : "s"}${
      failed ? ` · ${failed} couldn't be tagged` : ""
    }`;
    button.textContent = "Tagged";
    progressEl.hidden = true;
  } catch (error) {
    console.error("Eye failed to load", error);
    statusEl.textContent = window.crossOriginIsolated
      ? "The Eye model could not load. Check the console and your connection."
      : "The Eye model could not load. This page is not cross-origin isolated, so the wasm runtime has no SharedArrayBuffer — see the console.";
    progressEl.hidden = true;
  } finally {
    running = false;
    syncChrome();
  }
}

/** A tag needs at least this much confidence to file a photo a second time. */
const MULTI_TAG_CUTOFF = 0.7;

/** Every kind is filed; subject tags are capped so the overview stays readable. */
const MULTI_TAG_SUBJECT_LIMIT = 2;

/**
 * Every tag a photo belongs in, not just one: each kind it clears 0.5 on, plus
 * its strongest subject tags, so a beach portrait lands under both.
 *
 * The vocabulary stays filtered — generic tags (`photo`, `sharp`) and per-face
 * ones (`smiling`) describe the frame rather than the subject, and letting them
 * through would bury the overview in tiles that say nothing. `sensitive` stays
 * exclusive: a photo flagged there should not also be scattered across the
 * topical tags.
 */
function describe(analysis: Analysis): { labels: string[]; confidence: number } {
  const score = (tag: string) => analysis.confidence(tag) ?? 0;
  const solid = (tag: string) => score(tag) >= MULTI_TAG_CUTOFF;

  // Sensitive only files a photo at the strict cutoff: hiding or moving it
  // should not hinge on a 0.5 confidence.
  if (analysis.has("sensitive", "strict")) {
    return { labels: ["sensitive"], confidence: score("sensitive") };
  }

  // Content before quality. `blurry` fires on any shallow-depth-of-field frame —
  // a defocused café behind a mug — and on flat illustration, so it is left out
  // of the first pass and only used when nothing else recognised the photo.
  const matched = KIND_ORDER.filter(solid);

  // `confidences` carries every tag the model computed, so the 0.5 rule is
  // applied here rather than relying on a default level somewhere else. Scenes
  // keep the model's own ordering by confidence.
  const scenes = Object.entries(analysis.confidences)
    .filter(([tag, confidence]) => confidence >= MULTI_TAG_CUTOFF && !KIND_ORDER.includes(tag))
    .filter(([tag]) => !DESCRIPTIVE_EXTRAS.has(tag) && !FACET_TAGS.has(tag))
    .sort((a, b) => b[1] - a[1])
    // Every computed tag can clear 0.5: the scene head is 565 classes wide, and a
    // beach shot passes sand, sky, water and horizon all at once. Kinds plus the
    // two strongest subject tags are what describe a photo; the rest only add tiles.
    .slice(0, MULTI_TAG_SUBJECT_LIMIT);

  for (const [tag] of scenes) matched.push(tag);

  if (matched.length) return { labels: matched.map(pretty), confidence: score(matched[0]) };

  // Nothing recognisable: the photo is only "blurry" if the model is really
  // sure, using the strict cutoff rather than the recommended one.
  if (analysis.has("blurry", "strict")) {
    return { labels: ["blurry"], confidence: score("blurry") };
  }

  return { labels: ["other"], confidence: 0 };
}

function pretty(tag: string) {
  return tag.replace(/_/g, " ");
}

/** Folder picks carry their path, so two `IMG_0001.jpg` in different folders stay distinct. */
function photoKey(file: File) {
  return file.webkitRelativePath || file.name;
}

function makePhoto(file: File): Photo {
  const name = photoKey(file);
  const url = URL.createObjectURL(file);

  const img = new Image();
  img.src = url;
  img.alt = file.name;
  img.loading = "eager";
  img.decoding = "async";

  const card = document.createElement("button");
  card.type = "button";
  card.className = "card";
  card.dataset.key = name;
  card.title = name;
  card.append(img);

  const photo: Photo = {
    key: name,
    name,
    url,
    img,
    card,
    analysis: null,
    failed: false,
    labels: [],
    confidence: 0,
  };

  card.addEventListener("click", () => showPhoto(photo));
  return photo;
}

function isImage(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXTENSION.test(file.name);
}

/**
 * Add a batch to the library rather than replacing it. Photos already loaded
 * are kept, tags and all, so picking a second folder continues the same
 * library; `Clear current` is what empties it.
 */
async function loadFiles(candidates: File[]) {
  if (running) return;

  const images = candidates
    .filter(isImage)
    // The same file picked twice must not become two cards.
    .filter((file) => !photos.some((photo) => photo.key === photoKey(file)))
    .sort((a, b) => photoKey(a).localeCompare(photoKey(b)));

  if (!images.length) {
    statusEl.textContent = candidates.some(isImage)
      ? "Those photos are already in the library."
      : "No images in that drop.";
    return;
  }

  // Shuffled, so the grid never arrives pre-grouped.
  for (const file of shuffle(images)) photos.push(makePhoto(file));

  button.textContent = "Tag Images";
  syncChrome();
  statusEl.textContent =
    photos.length === images.length
      ? `${photos.length} photo${photos.length === 1 ? "" : "s"} · unsorted`
      : `${photos.length} photos · ${images.length} added`;
  render();
}

/** Empty the library, retiring every object URL and the tags with it. */
function clearLibrary() {
  if (running) return;

  for (const photo of photos) URL.revokeObjectURL(photo.url);
  photos.length = 0;
  ranks.clear();
  groupColors.clear();
  colorCursor = 0;
  tiles.clear();
  tilesEl.replaceChildren();
  detailGrid.replaceChildren();
  if (modal.open) modal.close();
  selected = null;

  button.textContent = "Tag Images";
  progressEl.hidden = true;
  setProgress(0);
  syncChrome();
  statusEl.textContent = "Drop a photo or a folder to begin";
  render();
}

/**
 * Static hosts cannot send COOP/COEP, so the page arrives without cross-origin
 * isolation and Eye's threaded wasm loses its SharedArrayBuffer. The service
 * worker in `public/coi-serviceworker.js` re-issues responses with those
 * headers; that only takes effect in the next document, hence the one reload.
 */
async function enableIsolation() {
  if (window.crossOriginIsolated || !("serviceWorker" in navigator)) return;

  // One attempt per tab: if isolation still does not take, a reload loop would
  // be far worse than a slower run.
  const guard = "coi-isolation-attempted";
  try {
    if (sessionStorage.getItem(guard)) return;

    const scope = import.meta.env.BASE_URL;
    const registration = await navigator.serviceWorker.register(`${scope}coi-serviceworker.js`, { scope });
    if (navigator.serviceWorker.controller) return;

    sessionStorage.setItem(guard, "1");
    if (registration.installing || registration.waiting) {
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    } else {
      location.reload();
    }
  } catch (error) {
    console.warn("Cross-origin isolation is unavailable; Eye will run slower.", error);
  }
}

function syncChrome() {
  const empty = photos.length === 0;
  dropzone.hidden = !empty;
  pickPhotos.hidden = empty;
  addFolder.hidden = empty;
  clearCurrent.hidden = empty;
  clearCurrent.disabled = running;
  button.disabled = empty || running;
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

function onDragEnter(event: DragEvent) {
  if (running || !hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  dropVeil.hidden = false;
}

function onDragOver(event: DragEvent) {
  if (running || !hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onDragLeave(event: DragEvent) {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropVeil.hidden = true;
}

function onDrop(event: DragEvent) {
  const data = event.dataTransfer;
  if (running || !data || !hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropVeil.hidden = true;

  // Entries and files have to be read synchronously: the transfer is emptied as
  // soon as this handler returns. Walking the tree afterwards is fine.
  const entries = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry());
  const plain = [...data.files];

  void (async () => {
    const found: File[] = [];
    for (const entry of entries) if (entry) await walkEntry(entry, found);
    await loadFiles(found.length ? found : plain);
  })();
}

/** Depth-first walk of a dropped folder, or the file itself. */
async function walkEntry(entry: FileSystemEntry, out: File[]) {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file && isImage(file)) out.push(file);
    return;
  }

  if (!entry.isDirectory) return;

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    // readEntries hands back at most 100 children per call, hence the loop.
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, out);
  }
}

/**
 * The grid shows the photo alone. A photo filed under several tags used to
 * advertise whichever tag happened to come first, which read as a wrong answer
 * under every other tag — so its tags live in the modal now.
 */
function paintCard(photo: Photo) {
  if (!modal.open || openedPhoto !== photo || !photo.analysis) return;
  // Fill the panel in once, at the moment the open photo finishes tagging.
  if (modalContent.dataset.tagged === "1") return;
  const scroll = modalContent.scrollTop;
  paintModal(photo);
  modalContent.scrollTop = scroll;
}

let openedPhoto: Photo | null = null;

/** A tag needs this much confidence to be called out rather than merely scored. */
const RECOMMENDED = 0.5;

function showPhoto(photo: Photo) {
  openedPhoto = photo;
  modalImage.src = photo.url;
  modalImage.alt = photo.name;
  modalTitle.textContent = photo.name;
  paintModal(photo);
  if (!modal.open) modal.showModal();
  modalContent.scrollTop = 0;
}

/** The photos in the order they sit in the grid behind the modal. */
function gridOrder(): Photo[] {
  return [...detailGrid.children]
    .map((node) => photos.find((photo) => photo.card === node))
    .filter((photo): photo is Photo => photo !== undefined);
}

/** Arrow keys walk the grid that opened the modal, wrapping at either end. */
function stepPhoto(step: number) {
  const order = gridOrder();
  const index = openedPhoto ? order.indexOf(openedPhoto) : -1;
  if (index === -1 || order.length < 2) return;
  const next = order[(index + step + order.length) % order.length];
  if (next) showPhoto(next);
}

/** Fill the panel from whatever Eye has produced so far. */
function paintModal(photo: Photo) {
  const analysis = photo.analysis;
  modalSub.textContent = analysis
    ? `${analysis.width} × ${analysis.height}${analysis.kind ? ` · ${pretty(analysis.kind)}` : ""}`
    : photo.failed
      ? "Eye couldn't read this photo"
      : "Not tagged yet";
  modalContent.dataset.tagged = analysis ? "1" : "0";
  modalContent.replaceChildren(...analysisSections(photo));
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title: string, ...body: Node[]): HTMLElement {
  const section = element("section", "panel");
  section.append(element("h3", "panel-title", title), ...body);
  return section;
}

function analysisSections(photo: Photo): HTMLElement[] {
  const analysis = photo.analysis;
  if (!analysis) {
    const note = photo.failed
      ? "Eye could not tag this one. The browser console has the reason."
      : "Tag the library and this photo's tags, scores and faces appear here.";
    return [panel(photo.failed ? "Tagging failed" : "Not tagged yet", element("p", "panel-note", note))];
  }

  const sections = [filedPanel(photo), factsPanel(analysis), tagsPanel(analysis)];
  const optional = [
    scoresPanel(analysis),
    qualityPanel(analysis),
    facesPanel(analysis),
    detectionPanel(analysis),
  ];
  for (const section of optional) if (section) sections.push(section);
  sections.push(rawPanel(analysis));
  return sections;
}

/** Every tag the photo was filed under, tinted with its group colour. */
function filedPanel(photo: Photo): HTMLElement {
  const list = element("div", "chip-list");
  if (!photo.labels.length) list.append(element("span", "panel-note", "Filed under no tag."));

  for (const label of photo.labels) {
    const chip = element("span", "chip-sm filed", label);
    const color = colorFor(label);
    if (color) {
      chip.style.borderColor = color;
      chip.style.color = color;
    }
    list.append(chip);
  }

  return panel("Filed under", list);
}

function factsPanel(analysis: Analysis): HTMLElement {
  const facts = element("div", "facts");

  const add = (label: string, value: string) => {
    const cell = element("div", "fact");
    cell.append(element("span", "fact-label", label), element("span", "fact-value", value));
    facts.append(cell);
  };

  add("Size", `${analysis.width} × ${analysis.height}`);
  if (analysis.kind) add("Type", pretty(analysis.kind));
  add("Model", analysis.model);
  if (analysis.rotation) add("Turned", `${analysis.rotation}° clockwise`);

  return panel("At a glance", facts);
}

/** The tags that cleared the cutoff, as ranked bars; the tail folded away. */
function tagsPanel(analysis: Analysis): HTMLElement {
  const entries = Object.entries(analysis.confidences).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const strong = entries.filter(([, value]) => value >= RECOMMENDED);
  const rest = entries.filter(([, value]) => value < RECOMMENDED);

  const body: Node[] = [];
  if (strong.length) {
    const rows = element("div", "tag-list");
    for (const [tag, value] of strong) rows.append(tagRow(pretty(tag), value));
    body.push(rows);
  } else {
    body.push(element("p", "panel-note", "No tag reached the 0.5 confidence cutoff."));
  }

  // The scene head alone computes 565 classes, most of them near zero: keep
  // them reachable without burying the tags that actually describe the photo.
  if (rest.length) {
    const details = element("details", "raw");
    details.append(element("summary", undefined, `Every scored tag · ${rest.length} under 0.5`));
    const chips = element("div", "chip-list");
    for (const [tag, value] of rest) chips.append(chipEl(pretty(tag), value));
    details.append(chips);
    body.push(details);
  }

  return panel("Tags", ...body);
}

function tagRow(name: string, value: number): HTMLElement {
  const row = element("div", "tag-row");
  row.append(element("span", "tag-name", name), element("span", "tag-value", value.toFixed(2)));

  const track = element("span", "tag-track");
  const fill = element("span", "tag-fill");
  fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  track.append(fill);
  row.append(track);

  return row;
}

function chipEl(name: string, value?: number): HTMLElement {
  const chip = element("span", "chip-sm");
  chip.append(name);
  if (value !== undefined) chip.append(" ", element("b", undefined, value.toFixed(2)));
  return chip;
}

function meter(name: string, value: number, note?: string): HTMLElement {
  const wrap = element("div", "meter");
  const head = element("div", "meter-head");
  head.append(element("span", "meter-name", name), element("span", "meter-value", `${Math.round(value * 100)}%`));

  const track = element("div", "meter-track");
  const fill = element("span");
  fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  track.append(fill);

  wrap.append(head, track);
  if (note) wrap.append(element("p", "meter-note", note));
  return wrap;
}

function scoresPanel(analysis: Analysis): HTMLElement | null {
  const scores = analysis.scores;
  if (!scores) return null;

  const notes = {
    aesthetic: "how good the photo is as a photograph",
    keeper: "how likely people are to keep a photo like this",
    cover: "how well it would work as a cover or thumbnail",
  } as const;

  const body = (Object.keys(notes) as (keyof typeof notes)[]).map((name) =>
    meter(name, scores[name], notes[name]),
  );
  return panel("Scores", ...body);
}

function qualityPanel(analysis: Analysis): HTMLElement | null {
  const details = analysis.details;
  if (!details) return null;

  const body: Node[] = [];
  if (details.sharpness) {
    body.push(meter("sharpness", details.sharpness.score, "how likely a person would call the photo sharp"));
  }

  const photo = details.photo;
  if (photo) {
    const attributes = Object.entries(photo.aestheticAttributes).sort((a, b) => b[1] - a[1]);
    if (attributes.length) {
      const rows = element("div", "attribute-list");
      for (const [name, rating] of attributes) {
        const row = element("div", "attribute");
        row.append(element("span", "attribute-name", pretty(name)));
        const dots = element("span", "dots");
        for (let step = 1; step <= 5; step++) {
          const dot = element("span", "dot");
          if (rating >= step - 0.25) dot.classList.add("on");
          dots.append(dot);
        }
        row.append(dots);
        rows.append(row);
      }
      body.push(rows);
    }

    const blur = topEntry(photo.blur);
    if (blur) body.push(element("p", "panel-note", `Focus reads as ${pretty(blur[0])} (${blur[1].toFixed(2)}).`));
    if (photo.bokeh >= 0.5) {
      body.push(element("p", "panel-note", `Strong background blur · bokeh ${photo.bokeh.toFixed(2)}.`));
    }
  }

  return body.length ? panel("Quality", ...body) : null;
}

function topEntry(scores: Record<string, number> | null | undefined): [string, number] | null {
  if (!scores) return null;
  let best: [string, number] | null = null;
  for (const [name, value] of Object.entries(scores)) {
    if (!best || value > best[1]) best = [name, value];
  }
  return best;
}

function facesPanel(analysis: Analysis): HTMLElement | null {
  const faces = analysis.faces;
  if (!faces?.length) return null;

  const list = element("div", "face-list");
  faces.forEach((face, index) => {
    const card = element("div", "face");
    const head = element("div", "face-head");
    head.append(
      element("span", undefined, `Face ${index + 1}`),
      element("span", "face-quality", `quality ${face.quality.toFixed(2)}`),
    );

    const chips = element("div", "chip-list");
    const tags = Object.entries(face.confidences)
      .filter(([, value]) => value >= RECOMMENDED)
      .sort((a, b) => b[1] - a[1]);
    if (tags.length) {
      for (const [tag, value] of tags) chips.append(chipEl(pretty(tag), value));
    } else {
      chips.append(element("span", "panel-note", "Nothing notable."));
    }

    card.append(head, chips);
    list.append(card);
  });

  return panel("Faces", list);
}

/** How many people, cats and dogs the layout part found, by label. */
function detectionPanel(analysis: Analysis): HTMLElement | null {
  const detections = [...(analysis.people ?? []), ...(analysis.pets ?? [])];
  if (!detections.length) return null;

  const counts = new Map<string, number>();
  for (const detection of detections) counts.set(detection.label, (counts.get(detection.label) ?? 0) + 1);

  const facts = element("div", "facts");
  for (const [label, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const cell = element("div", "fact");
    cell.append(element("span", "fact-label", pretty(label)), element("span", "fact-value", String(count)));
    facts.append(cell);
  }

  return panel("In the frame", facts);
}

function rawPanel(analysis: Analysis): HTMLElement {
  const details = element("details", "raw");
  details.append(element("summary", undefined, "Raw JSON"));
  details.append(element("pre", "raw-json", JSON.stringify(analysis, null, 2)));
  return details;
}

/** One live tile per tag, reused so the overview never rebuilds under the viewer. */
interface TileView {
  root: HTMLButtonElement;
  count: HTMLElement;
  bar: HTMLElement;
}

interface Bucket {
  label: string;
  members: Photo[];
}

function colorFor(label: string): string | null {
  if (label === "Unsorted" || label === "Couldn't tag") return null;
  let color = groupColors.get(label);
  if (!color) {
    color = GROUP_PALETTE[colorCursor++ % GROUP_PALETTE.length];
    groupColors.set(label, color);
  }
  return color;
}

/** First-seen order, used to freeze the section order while a run is in progress. */
function rankFor(label: string) {
  let rank = ranks.get(label);
  if (rank === undefined) {
    rank = ranks.size;
    ranks.set(label, rank);
  }
  return rank;
}

function createTile(label: string): TileView {
  const name = document.createElement("span");
  name.className = "tile-label";
  name.textContent = label;

  const count = document.createElement("span");
  count.className = "tile-count";
  count.textContent = "0";

  const bar = document.createElement("span");
  bar.className = "tile-bar-inner";
  const track = document.createElement("span");
  track.className = "tile-bar";
  track.append(bar);

  const root = document.createElement("button");
  root.type = "button";
  root.className = "tile";
  root.dataset.label = label;
  const color = colorFor(label);
  if (color) root.style.setProperty("--group", color);
  root.append(name, count, track);
  root.addEventListener("click", () => openTag(label));

  return { root, count, bar };
}

/** Show one tag's photos, or return to the overview with `null`. */
function openTag(label: string | null) {
  selected = label;
  render();
}

/**
 * The overview is the default surface: counters and one tile per tag, never the
 * photos themselves. It is a reconcile rather than a rebuild, so counts tick up
 * in place and a new tag arrives without the tiles jumping around mid-run.
 */
function render(settle = false) {
  const { tagged, unsorted, tags } = totals();
  statPhotos.textContent = String(photos.length);
  statTagged.textContent = String(tagged);
  statUnsorted.textContent = String(unsorted);
  statTags.textContent = String(tags);

  syncViews();
  renderTiles(settle);
  if (selected !== null) renderDetail();
}

function syncViews() {
  const empty = photos.length === 0;
  overviewEl.hidden = empty || selected !== null;
  detailEl.hidden = empty || selected === null;
}

function totals() {
  let tagged = 0;
  let unsorted = 0;
  let failed = 0;
  const labels = new Set<string>();

  for (const photo of photos) {
    if (photo.failed) {
      failed++;
      continue;
    }
    if (!photo.analysis) {
      unsorted++;
      continue;
    }
    tagged++;
    for (const label of photo.labels) labels.add(label);
  }

  return { tagged, unsorted, tags: labels.size, failed };
}

function renderTiles(settle: boolean) {
  const entries = buckets();

  if (settle) {
    entries.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
  } else {
    // Stamp ranks in first-seen order, before sorting, so they stay meaningful.
    for (const entry of entries) rankFor(entry.label);
    entries.sort((a, b) => ranks.get(a.label)! - ranks.get(b.label)!);
  }

  const total = Math.max(1, photos.length);
  const order: HTMLElement[] = [];

  for (const { label, members } of entries) {
    let view = tiles.get(label);
    if (!view) {
      view = createTile(label);
      tiles.set(label, view);
    }
    view.count.textContent = String(members.length);
    view.bar.style.width = `${Math.round((members.length / total) * 100)}%`;
    view.root.classList.toggle("active", selected === label);
    order.push(view.root);
  }

  // Retire tiles whose tag no longer holds anything.
  for (const [label, view] of tiles) {
    if (order.includes(view.root)) continue;
    view.root.remove();
    tiles.delete(label);
  }

  const current = [...tilesEl.children];
  if (current.length !== order.length || order.some((el, i) => current[i] !== el)) {
    tilesEl.replaceChildren(...order);
  }
}

function renderDetail() {
  const bucket = buckets().find((entry) => entry.label === selected);
  const members = bucket?.members ?? [];

  detailTitle.textContent = selected ?? "";
  detailCount.textContent = String(members.length);
  detailEl.style.setProperty("--group", (selected && colorFor(selected)) || "var(--muted)");

  // Insert only what is missing, in order, so an open tag grows live.
  let cursor = 0;
  for (const photo of members) {
    const existing = detailGrid.children[cursor];
    if (existing !== photo.card) detailGrid.insertBefore(photo.card, existing ?? null);
    paintCard(photo);
    cursor++;
  }
  while (detailGrid.children.length > members.length) detailGrid.lastElementChild!.remove();
}

/** Every tag with its photos, in first-seen order; the unsorted queue trails. */
function buckets(): Bucket[] {
  const pending: Photo[] = [];
  const grouped = new Map<string, Photo[]>();

  for (const photo of photos) {
    if (photo.failed) {
      push(grouped, "Couldn't tag", photo);
      continue;
    }
    if (!photo.analysis) {
      pending.push(photo);
      continue;
    }
    // A photo joins every tag it cleared the cutoff on, so it can sit in several
    // buckets at once.
    for (const label of photo.labels) push(grouped, label, photo);
    if (!photo.labels.length) push(grouped, "other", photo);
  }

  const entries: Bucket[] = [...grouped.entries()].map(([label, members]) => ({ label, members }));
  if (pending.length) entries.push({ label: "Unsorted", members: pending });
  return entries;
}

function push(map: Map<string, Photo[]>, key: string, photo: Photo) {
  const list = map.get(key);
  if (list) list.push(photo);
  else map.set(key, [photo]);
}

function setProgress(fraction: number) {
  progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
