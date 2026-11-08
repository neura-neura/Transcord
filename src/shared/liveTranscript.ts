/* SPDX-License-Identifier: GPL-3.0-or-later */

function commonPrefix(left: string, right: string) {
    let index = 0;
    while (index < left.length && index < right.length && left[index] === right[index]) index++;
    if (index && /[\uD800-\uDBFF]/.test(left[index - 1])) index--;
    return index;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createLiveTranscript(view: HTMLElement, motionEnabled = () => !reducedMotion()) {
    let source = "";
    let pages = [0];
    let page = 0;
    let following = true;
    let displayed = "";
    let needsLayout = false;
    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    let fade: Animation | undefined;
    let measure: HTMLElement | undefined;

    function cancelTurn() {
        clearTimeout(turnTimer);
        turnTimer = undefined;
        fade?.cancel();
        fade = undefined;
    }

    function paint(text: string, animate: boolean) {
        if (text === displayed) return;
        if (!animate || !motionEnabled()) view.textContent = text;
        else {
            const prefix = commonPrefix(displayed, text);
            if (prefix !== displayed.length) {
                // Hex revises the end of each hypothesis. Keep the existing nodes and their
                // animations for the part that was not revised.
                let left = prefix;
                for (const node of Array.from(view.childNodes)) {
                    const value = node.textContent ?? "";
                    if (left >= value.length) left -= value.length;
                    else if (left) {
                        node.textContent = value.slice(0, left);
                        left = 0;
                    } else node.remove();
                }
            }
            const tokens = [...words.segment(text.slice(prefix))].map(part => part.segment);
            const fragment = document.createDocumentFragment();
            const effects: HTMLSpanElement[] = [];
            for (let i = 0; i < tokens.length; i++) {
                const token = i === 20 ? tokens.slice(i).join("") : tokens[i];
                if (!token.trim()) fragment.append(token);
                else {
                    const span = document.createElement("span");
                    span.className = "transcord-live-tail";
                    span.textContent = token;
                    effects.push(span);
                    fragment.append(span);
                }
                if (i === 20) break;
            }
            view.append(fragment);
            effects.forEach((span, index) => {
                span.animate([{ opacity: 0 }, { opacity: 1 }], {
                    duration: 360,
                    delay: Math.min(index * 32, 290),
                    easing: "ease-out",
                    fill: "backwards"
                });
            });
        }
        displayed = text;
    }

    function nextBoundary(start: number) {
        let end = Math.min(start + 750, source.length);
        if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1])) end--;
        const rest = source.slice(start, end);
        const box = measure!;
        box.textContent = rest;
        if (box.scrollHeight <= view.clientHeight + 1) return end;
        const cuts = Array.from(graphemes.segment(rest), part => part.index).slice(1);
        cuts.push(rest.length);
        let lo = 0;
        let hi = cuts.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            box.textContent = rest.slice(0, cuts[mid]);
            if (box.scrollHeight <= view.clientHeight + 1) lo = mid;
            else hi = mid - 1;
        }
        const lastWord = rest.slice(0, cuts[lo]).search(/\s+\S*$/);
        return start + (lastWord > cuts[lo] * 0.8 ? lastWord + 1 : cuts[lo]);
    }

    function pageText() {
        return source.slice(pages[page], pages[page + 1] ?? source.length);
    }

    function draw(animate = true) {
        paint(pageText(), animate);
    }

    function replacePage() {
        const advance = (animate: boolean) => {
            if (page < pages.length - 1) {
                page++;
                displayed = "";
                view.replaceChildren();
                draw(animate);
            }
            scheduleTurn();
        };
        if (!motionEnabled() || !displayed) {
            advance(false);
            return;
        }
        // Fade the old text in place; keep the box and its background steady.
        const transition = (fade = view.animate([{ color: "currentColor" }, { color: "transparent" }], {
            duration: 210,
            easing: "ease-in",
            fill: "forwards"
        }));
        void transition.finished.then(
            () => {
                if (fade !== transition) return;
                fade = undefined;
                transition.cancel();
                advance(true);
            },
            () => {}
        );
    }

    function scheduleTurn() {
        if (!following || page >= pages.length - 1 || turnTimer || fade) return;
        // Hold the current block for reading; shorten only the hold if several blocks are queued.
        turnTimer = setTimeout(
            () => {
                turnTimer = undefined;
                if (following && page < pages.length - 1) replacePage();
            },
            pages.length - page > 3 ? 360 : 650
        );
    }

    function setText(text: string) {
        if (text === source && !needsLayout) return;
        if (!text.trim()) {
            cancelTurn();
            view.hidden = true;
            view.replaceChildren();
            if (measure) measure.textContent = "";
            source = displayed = "";
            pages = [0];
            page = 0;
            following = true;
            return;
        }
        const shared = needsLayout ? 0 : commonPrefix(source, text);
        needsLayout = false;
        if (!shared) {
            cancelTurn();
            pages = [0];
            page = 0;
            following = true;
            displayed = "";
            view.replaceChildren();
        } else {
            while (pages.length > 1 && pages.at(-1)! > shared) pages.pop();
        }
        source = text;
        view.hidden = false;
        if (!view.clientHeight) {
            needsLayout = true;
            return;
        }
        if (!measure) {
            measure = view.cloneNode(false) as HTMLElement;
            measure.removeAttribute("id");
            measure.setAttribute("aria-hidden", "true");
            measure.classList.add("transcord-live-measure");
            view.after(measure);
        }
        measure.hidden = false;
        measure.style.width = view.getBoundingClientRect().width + "px";
        for (let end = nextBoundary(pages.at(-1)!); end < source.length; end = nextBoundary(end)) pages.push(end);
        page = Math.min(page, pages.length - 1);
        draw();
        scheduleTurn();
    }

    view.addEventListener(
        "wheel",
        event => {
            const next = Math.min(Math.max(0, page + Math.sign(event.deltaY)), pages.length - 1);
            if (next === page) return;
            event.preventDefault();
            cancelTurn();
            page = next;
            following = page === pages.length - 1;
            displayed = "";
            view.replaceChildren();
            draw(false);
        },
        { passive: false }
    );
    return setText;
}
