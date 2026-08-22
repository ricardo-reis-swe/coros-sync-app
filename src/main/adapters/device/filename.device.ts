import { ItemType } from '../../../shared/data.types';

export const MAX_STEM = 120;
const EXTENSION = '.mp3';

const FAT_FORBIDDEN = /[<>:"/\\|?*]/g;
const CONTROL_CHARS = /\p{Cc}/gu;

/** One FAT-safe rule on every host OS — the constraint is the device's, not the desktop's. (ADR-0015) */
export const sanitise = (input: string): string =>
    input
        .replace(FAT_FORBIDDEN, '')
        .replace(CONTROL_CHARS, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');

export type NameableItem = {
    type: ItemType;
    title: string;
    author?: string;
};

/** One planned output's own facts — everything the name is composed from. */
export type OutputSpec = {
    chapterIndex?: number;
    chapterTitle?: string;
    partIndex: number;
    /** Is this chapter cut into more than one part? An unsplit chapter omits `- PP`. */
    split: boolean;
};

const MAX_DISAMBIGUATOR = 999;

/** Both of an output's names, index for index. Sync picks a list; it never composes. (ADR-0040) */
export type DeviceNames = {
    composed: string[];
    plain: string[];
};

/** Pure, generated once, immutable after; one disambiguator for both spaces. (ADR-0019 / ADR-0040) */
export const generateDeviceFilenames = (
    item: NameableItem,
    specs: OutputSpec[],
    taken: ReadonlySet<string> = new Set(),
): DeviceNames => {
    const base = sanitise(item.title);

    for (let d = 1; d <= MAX_DISAMBIGUATOR; d++) {
        const suffix = d === 1 ? '' : ` (${d})`;
        const composed = specs.map((spec) => assemble(item, base, suffix, spec));
        const plain = specs.map((_, i) => assemblePlain(base, suffix, i, specs.length));

        if (!clashes(composed, plain, taken)) return { composed, plain };
    }

    throw new Error(`Could not find a free device filename for "${item.title}"`);
};

/** One row's own two names may agree — that is media with no author. Any other pairing may not. */
const clashes = (composed: string[], plain: string[], taken: ReadonlySet<string>): boolean => {
    if (new Set(composed).size !== composed.length) return true;
    if (new Set(plain).size !== plain.length) return true;
    if (composed.some((name) => taken.has(name)) || plain.some((name) => taken.has(name))) {
        return true;
    }

    const plainAt = new Map(plain.map((name, i) => [name, i]));
    return composed.some((name, i) => {
        const at = plainAt.get(name);
        return at !== undefined && at !== i;
    });
};

/** The absence of composition, so it has no per-type form: the title, and an index only on fan-out. */
const assemblePlain = (
    titleBase: string,
    suffix: string,
    index: number,
    count: number,
): string => {
    // Cosmetic, like 0019's padding: filenames order nothing on this watch. (ADR-0035)
    const nn = count > 1 ? ` - ${pad(index + 1)}` : '';
    const build = (title: string) => `${title}${suffix}${nn}`;

    return withExtension(build(shrink(titleBase, build)));
};

const assemble = (
    item: NameableItem,
    titleBase: string,
    suffix: string,
    spec: OutputSpec,
): string => {
    if (item.type === 'media') {
        // Media is N = 1: no chapter or part components.
        const author = item.author ? sanitise(item.author) : '';
        const prefix = author ? `${author} - ` : '';
        const build = (title: string) => `${prefix}${title}${suffix}`;

        return withExtension(build(shrink(titleBase, build)));
    }

    // Audiobook: <titleComp> - <CC> [- <chapterTitleComp>] [- <PP>]
    const cc = pad(spec.chapterIndex ?? 1);
    const pp = spec.split ? ` - ${pad(spec.partIndex)}` : '';
    const chapterTitle = spec.chapterTitle ? sanitise(spec.chapterTitle) : '';

    const build = (title: string, chapter: string) =>
        `${title}${suffix} - ${cc}${chapter ? ` - ${chapter}` : ''}${pp}`;

    // Only free text gives way, chapter title first — ` - CC`, ` - PP`, ` (D)` never truncate.
    const chapter = shrink(chapterTitle, (candidate) => build(titleBase, candidate));
    const title = shrink(titleBase, (candidate) => build(candidate, chapter));

    return withExtension(build(title, chapter));
};

/** The 120 cap is the device's, so it is enforced unconditionally, not just budgeted. */
const withExtension = (stem: string): string =>
    (stem.length <= MAX_STEM ? stem : stem.slice(0, MAX_STEM).trimEnd()) + EXTENSION;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Trims one component against the *assembled* stem, so freed separator space is reused. */
const shrink = (component: string, build: (candidate: string) => string): string => {
    const excess = build(component).length - MAX_STEM;
    if (excess <= 0) return component;

    return component.slice(0, Math.max(0, component.length - excess)).trimEnd();
};
